/**
 * Read Model Service - Full Implementation
 * 
 * Maintains an in-memory cache of orders and trades from Canton.
 * Periodically refreshes from Canton to ensure consistency.
 */

const EventEmitter = require('events');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class ReadModelService extends EventEmitter {
    constructor(cantonService) {
        super();
        this.cantonService = cantonService;
        this.orderBooks = new Map();  // tradingPair -> { bids: [], asks: [] }
        this.orders = new Map();       // contractId -> order data
        this.ordersById = new Map();   // orderId -> order data
        this.trades = new Map();       // tradingPair -> [trades]
        this.allTrades = [];
        this.refreshIntervalMs = 5000; // Refresh every 5 seconds
        this.refreshInterval = null;
        this.isRefreshing = false;
    }

    async initialize() {
        console.log('[ReadModel] Initializing...');
        
        // Do initial load
        await this.refreshFromCanton();
        
        // Start periodic refresh
        this.startPeriodicRefresh();
        
        console.log('[ReadModel] ✅ Initialization complete');
    }

    startPeriodicRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(async () => {
            await this.refreshFromCanton();
        }, this.refreshIntervalMs);
    }

    async refreshFromCanton() {
        if (this.isRefreshing) return;
        
        try {
            this.isRefreshing = true;
            
            const token = await tokenProvider.getServiceToken();
            const packageId = config.canton.packageIds?.clobExchange;
            const operatorPartyId = config.canton.operatorPartyId;
            
            if (!packageId || !operatorPartyId) {
                return;
            }

            // Query Order contracts
            const orderTemplateId = `${packageId}:Order:Order`;
            const contracts = await this.cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds: [orderTemplateId],
                pageSize: 100
            }, token);

            const contractArray = Array.isArray(contracts) ? contracts : (contracts?.activeContracts || []);
            
            // If we got 0 contracts due to the 200+ limit, don't clear existing cache
            if (contractArray.length === 0) {
                console.log('[ReadModel] Refresh returned 0 contracts (likely 200+ limit), keeping existing cache');
                return;
            }
            
            // Clear and rebuild order books
            this.orders.clear();
            this.ordersById.clear();
            const newOrderBooks = new Map();
            
            for (const contract of contractArray) {
                const contractId = contract.contractId || 
                                 contract.contractEntry?.JsActiveContract?.createdEvent?.contractId;
                const payload = contract.payload || 
                              contract.createArgument ||
                              contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
                
                if (!contractId || !payload.orderId) continue;
                
                const order = {
                    contractId,
                    orderId: payload.orderId,
                    owner: payload.owner,
                    tradingPair: payload.tradingPair,
                    orderType: payload.orderType,
                    orderMode: payload.orderMode,
                    price: payload.price?.Some || payload.price || null,
                    quantity: parseFloat(payload.quantity || 0),
                    filled: parseFloat(payload.filled || 0),
                    status: payload.status,
                    timestamp: payload.timestamp,
                    operator: payload.operator
                };
                
                this.orders.set(contractId, order);
                this.ordersById.set(order.orderId, order);
                
                // Add to order book if OPEN
                if (order.status === 'OPEN' && order.tradingPair) {
                    if (!newOrderBooks.has(order.tradingPair)) {
                        newOrderBooks.set(order.tradingPair, { bids: [], asks: [], lastPrice: null });
                    }
                    
                    const book = newOrderBooks.get(order.tradingPair);
                    const orderEntry = {
                        price: order.price,
                        quantity: order.quantity,
                        remaining: order.quantity - order.filled,
                        orderId: order.orderId,
                        owner: order.owner,
                        contractId: order.contractId,
                        timestamp: order.timestamp
                    };
                    
                    if (order.orderType === 'BUY') {
                        book.bids.push(orderEntry);
                    } else if (order.orderType === 'SELL') {
                        book.asks.push(orderEntry);
                    }
                }
            }
            
            // Sort order books
            for (const [pair, book] of newOrderBooks) {
                // Bids: highest price first
                book.bids.sort((a, b) => {
                    const priceA = parseFloat(a.price) || 0;
                    const priceB = parseFloat(b.price) || 0;
                    return priceB - priceA;
                });
                
                // Asks: lowest price first
                book.asks.sort((a, b) => {
                    const priceA = parseFloat(a.price) || Infinity;
                    const priceB = parseFloat(b.price) || Infinity;
                    return priceA - priceB;
                });
                
                book.timestamp = new Date().toISOString();
            }
            
            this.orderBooks = newOrderBooks;
            
            // Emit update event
            this.emit('orderbook-updated');
            
        } catch (error) {
            // Silently handle errors during refresh
            if (!error.message?.includes('200+') && !error.message?.includes('MAXIMUM_LIST')) {
                console.error('[ReadModel] Refresh error:', error.message);
            }
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Add an order to the cache (called when order is placed)
     */
    addOrder(order) {
        if (!order || !order.contractId) {
            console.log('[ReadModel] addOrder: Invalid order - no contractId');
            return;
        }
        
        console.log(`[ReadModel] Adding order ${order.orderId} to cache:`, {
            tradingPair: order.tradingPair,
            orderType: order.orderType,
            status: order.status,
            price: order.price
        });
        
        this.orders.set(order.contractId, order);
        if (order.orderId) {
            this.ordersById.set(order.orderId, order);
        }
        
        // Add to order book
        if (order.status === 'OPEN' && order.tradingPair) {
            if (!this.orderBooks.has(order.tradingPair)) {
                console.log(`[ReadModel] Creating new order book for ${order.tradingPair}`);
                this.orderBooks.set(order.tradingPair, { bids: [], asks: [], lastPrice: null, timestamp: new Date().toISOString() });
            }
            
            const book = this.orderBooks.get(order.tradingPair);
            const orderEntry = {
                price: order.price,
                quantity: order.quantity || parseFloat(order.quantity),
                remaining: (order.quantity || 0) - (order.filled || 0),
                orderId: order.orderId,
                owner: order.owner,
                contractId: order.contractId,
                timestamp: order.timestamp
            };
            
            if (order.orderType === 'BUY') {
                book.bids.push(orderEntry);
                // Re-sort bids
                book.bids.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
                console.log(`[ReadModel] Added BUY order to ${order.tradingPair}, total bids: ${book.bids.length}`);
            } else if (order.orderType === 'SELL') {
                book.asks.push(orderEntry);
                // Re-sort asks
                book.asks.sort((a, b) => (parseFloat(a.price) || Infinity) - (parseFloat(b.price) || Infinity));
                console.log(`[ReadModel] Added SELL order to ${order.tradingPair}, total asks: ${book.asks.length}`);
            }
            
            book.timestamp = new Date().toISOString();
            
            // Emit update
            this.emit('orderbook-updated', order.tradingPair);
        } else {
            console.log(`[ReadModel] Order not added to book: status=${order.status}, pair=${order.tradingPair}`);
        }
    }

    /**
     * Remove an order from the cache
     */
    removeOrder(contractIdOrOrderId) {
        let order = this.orders.get(contractIdOrOrderId) || this.ordersById.get(contractIdOrOrderId);
        if (!order) return;
        
        this.orders.delete(order.contractId);
        this.ordersById.delete(order.orderId);
        
        // Remove from order book
        if (order.tradingPair && this.orderBooks.has(order.tradingPair)) {
            const book = this.orderBooks.get(order.tradingPair);
            book.bids = book.bids.filter(o => o.contractId !== order.contractId && o.orderId !== order.orderId);
            book.asks = book.asks.filter(o => o.contractId !== order.contractId && o.orderId !== order.orderId);
            book.timestamp = new Date().toISOString();
        }
    }

    getOrderBook(tradingPair) {
        const book = this.orderBooks.get(tradingPair);
        console.log(`[ReadModel] getOrderBook(${tradingPair}): has=${!!book}, bids=${book?.bids?.length || 0}, asks=${book?.asks?.length || 0}`);
        if (!book) {
            return { bids: [], asks: [], lastPrice: null, timestamp: new Date().toISOString() };
        }
        return book;
    }

    getUserOrders(partyId, options = {}) {
        const { status, tradingPair, limit = 100 } = options;
        
        const orders = Array.from(this.orders.values())
            .filter(order => {
                if (order.owner !== partyId) return false;
                if (status && order.status !== status) return false;
                if (tradingPair && order.tradingPair !== tradingPair) return false;
                return true;
            })
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);
        
        return orders;
    }

    getRecentTrades(pair = null, limit = 50) {
        if (pair) {
            return (this.trades.get(pair) || []).slice(0, limit);
        }
        return this.allTrades.slice(0, limit);
    }

    getAllOrderBooks() {
        const result = [];
        for (const [pair, book] of this.orderBooks) {
            result.push({
                pair,
                bids: book.bids,
                asks: book.asks,
                lastPrice: book.lastPrice,
                timestamp: book.timestamp
            });
        }
        return result;
    }

    getOrderByContractId(contractId) {
        return this.orders.get(contractId) || null;
    }

    getOrderByOrderId(orderId) {
        return this.ordersById.get(orderId) || null;
    }

    async shutdown() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        console.log('[ReadModel] Shutdown complete');
    }
}

// Singleton instance
let instance = null;

function getReadModelService(cantonService = null) {
    if (!instance && cantonService) {
        instance = new ReadModelService(cantonService);
    }
    return instance;
}

function initReadModelService(cantonService) {
    if (!instance) {
        instance = new ReadModelService(cantonService);
    }
    return instance;
}

module.exports = {
    ReadModelService,
    getReadModelService,
    initReadModelService
};
