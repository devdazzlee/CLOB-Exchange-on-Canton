/**
 * Order Book Service - DIRECT CANTON API QUERIES
 * 
 * NO CACHE - ALL data comes directly from Canton API
 * 
 * NOTE: Canton JSON API has a 200 element limit.
 * For global order books with 200+ orders, you must:
 * 1. Contact your Canton deployment admin to increase the limit
 * 2. Or use a database alongside Canton for order storage
 */

const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');

class OrderBookService {
    constructor() {
        console.log('[OrderBookService] Initialized - DIRECT Canton API queries (no cache)');
    }

    /**
     * Get order book for a trading pair - DIRECTLY from Canton API
     * NO CACHE - Always queries Canton
     */
    async getOrderBook(tradingPair) {
        console.log(`[OrderBookService] Querying Canton DIRECTLY for ${tradingPair}`);
        
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;

        if (!packageId || !operatorPartyId) {
            console.warn('[OrderBookService] Missing packageId or operatorPartyId');
            return this.emptyOrderBook(tradingPair);
        }

        try {
            // Query Order contracts DIRECTLY from Canton
            const contracts = await cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds: [`${packageId}:Order:Order`],
                pageSize: 200  // Max allowed by Canton
            }, token);

            const contractArray = Array.isArray(contracts) ? contracts : [];
            
            // If Canton returned empty (200+ limit error), warn and return empty
            if (contractArray.length === 0) {
                console.warn('[OrderBookService] Canton returned 0 contracts - may have hit 200+ limit');
                console.warn('[OrderBookService] Contact your Canton admin to increase JSON_API_MAXIMUM_LIST_ELEMENTS');
                return this.emptyOrderBook(tradingPair);
            }

            // Filter for this trading pair and OPEN status
            const buyOrders = [];
            const sellOrders = [];
            
            for (const c of contractArray) {
                const payload = c.payload || c.createArgument || {};
                
                if (payload.tradingPair !== tradingPair || payload.status !== 'OPEN') {
                    continue;
                }
                
                const order = {
                    contractId: c.contractId,
                    orderId: payload.orderId,
                    owner: payload.owner,
                    price: payload.price?.Some || payload.price,
                    quantity: parseFloat(payload.quantity || 0),
                    filled: parseFloat(payload.filled || 0),
                    remaining: parseFloat(payload.quantity || 0) - parseFloat(payload.filled || 0),
                    timestamp: payload.timestamp
                };
                
                if (payload.orderType === 'BUY') {
                    buyOrders.push(order);
                } else if (payload.orderType === 'SELL') {
                    sellOrders.push(order);
                }
            }
            
            // Sort: bids highest first, asks lowest first
            buyOrders.sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
            sellOrders.sort((a, b) => parseFloat(a.price || Infinity) - parseFloat(b.price || Infinity));
            
            console.log(`[OrderBookService] Canton returned: ${buyOrders.length} buys, ${sellOrders.length} sells for ${tradingPair}`);

            return {
                tradingPair,
                buyOrders,
                sellOrders,
                lastPrice: buyOrders[0]?.price || sellOrders[0]?.price || null,
                timestamp: new Date().toISOString(),
                source: 'canton-api-direct'
            };
        } catch (error) {
            console.error(`[OrderBookService] Canton query failed: ${error.message}`);
            
            if (error.message?.includes('200') || error.message?.includes('MAXIMUM_LIST')) {
                console.error('[OrderBookService] ❌ Canton 200 element limit reached');
                console.error('[OrderBookService] Contact your Canton admin to increase JSON_API_MAXIMUM_LIST_ELEMENTS');
            }
            
            return this.emptyOrderBook(tradingPair);
        }
    }

    /**
     * Return empty order book structure
     */
    emptyOrderBook(tradingPair) {
        return {
            tradingPair,
            buyOrders: [],
            sellOrders: [],
            lastPrice: null,
            timestamp: new Date().toISOString(),
            source: 'empty'
        };
    }

    /**
     * Get all order books - DIRECTLY from Canton API
     */
    async getAllOrderBooks() {
        const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
        const orderBooks = [];
        
        for (const pair of pairs) {
            const book = await this.getOrderBook(pair);
            if (book.buyOrders.length > 0 || book.sellOrders.length > 0) {
                orderBooks.push(book);
            }
        }
        
        return orderBooks;
    }

    /**
     * Get trades - DIRECTLY from Canton API
     */
    async getTrades(tradingPair, limit = 50) {
        console.log(`[OrderBookService] Querying Canton DIRECTLY for trades: ${tradingPair}`);
        
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;

        if (!packageId || !operatorPartyId) {
            return [];
        }

        try {
            const contracts = await cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds: [`${packageId}:Trade:Trade`],
                pageSize: limit
            }, token);

            const trades = (Array.isArray(contracts) ? contracts : [])
                .filter(c => {
                    const payload = c.payload || c.createArgument || {};
                    return payload.tradingPair === tradingPair;
                })
                .map(c => {
                    const payload = c.payload || c.createArgument || {};
                    return {
                        contractId: c.contractId,
                        tradeId: payload.tradeId,
                        tradingPair: payload.tradingPair,
                        buyer: payload.buyer,
                        seller: payload.seller,
                        price: payload.price,
                        quantity: payload.quantity,
                        timestamp: payload.timestamp
                    };
                })
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                .slice(0, limit);

            console.log(`[OrderBookService] Canton returned ${trades.length} trades for ${tradingPair}`);
            return trades;
        } catch (error) {
            console.error(`[OrderBookService] Trade query failed: ${error.message}`);
            return [];
        }
    }

    /**
     * Create order book - Not needed as orders are created directly
     * This is a stub for backward compatibility
     */
    async createOrderBook(tradingPair) {
        console.log(`[OrderBookService] Order book creation not needed for ${tradingPair}`);
        return { 
            contractId: `virtual-${tradingPair}`,
            alreadyExists: true 
        };
    }
}

// Singleton
let instance = null;
function getOrderBookService() {
    if (!instance) {
        instance = new OrderBookService();
    }
    return instance;
}

module.exports = { OrderBookService, getOrderBookService };
