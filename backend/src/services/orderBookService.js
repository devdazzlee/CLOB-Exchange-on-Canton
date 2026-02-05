/**
 * Order Book Service - DIRECT CANTON API QUERIES
 * 
 * Uses Canton WebSocket streaming for global order book (bypasses 200 element limit)
 * Uses Canton REST API for per-user queries (< 200 contracts per user)
 * 
 * Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/asyncapi.html
 */

const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');

class OrderBookService {
    constructor() {
        console.log('[OrderBookService] Initialized - DIRECT Canton API queries (no cache)');
    }

    /**
     * Get order book for a trading pair - DIRECTLY from Canton REST API
     * 
     * Canton JSON API returns data in nested format that is now properly parsed
     * by cantonService.queryActiveContracts()
     */
    async getOrderBook(tradingPair) {
        console.log(`[OrderBookService] Querying Canton for ${tradingPair}`);
        
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;

        if (!packageId || !operatorPartyId) {
            console.warn('[OrderBookService] Missing packageId or operatorPartyId');
            return this.emptyOrderBook(tradingPair);
        }

        try {
            const token = await tokenProvider.getServiceToken();
            
            // Query Order contracts from Canton
            // cantonService now properly parses the nested JsActiveContract response
            const contracts = await cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds: [`${packageId}:Order:Order`],
                pageSize: 200
            }, token);

            const contractArray = Array.isArray(contracts) ? contracts : [];
            console.log(`[OrderBookService] Canton returned ${contractArray.length} Order contracts`);

            const buyOrders = [];
            const sellOrders = [];
            
            for (const c of contractArray) {
                // cantonService.queryActiveContracts now normalizes the response
                // payload contains the actual contract data (createArgument)
                const payload = c.payload || c.createArgument || {};
                
                // Filter for this trading pair and OPEN status
                if (payload.tradingPair !== tradingPair || payload.status !== 'OPEN') {
                    continue;
                }
                
                const order = {
                    contractId: c.contractId,
                    orderId: payload.orderId,
                    owner: payload.owner,
                    price: payload.price, // Already normalized (not wrapped in {Some:...})
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
            
            console.log(`[OrderBookService] Filtered: ${buyOrders.length} buys, ${sellOrders.length} sells for ${tradingPair}`);

            return {
                tradingPair,
                buyOrders,
                sellOrders,
                lastPrice: buyOrders[0]?.price || sellOrders[0]?.price || null,
                timestamp: new Date().toISOString(),
                source: 'canton-api'
            };
        } catch (error) {
            console.error(`[OrderBookService] Query failed: ${error.message}`);
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
     * Includes Splice Token Standard pairs (CBTC, CC)
     */
    async getAllOrderBooks() {
        // All supported trading pairs - includes Splice Token Standard tokens
        const pairs = [
            'BTC/USDT',    // Standard BTC pair
            'ETH/USDT',    // Standard ETH pair
            'SOL/USDT',    // Standard SOL pair
            'CBTC/USDT',   // Canton BTC (Splice Token Standard)
            'CC/CBTC',     // Canton Coin / Canton BTC
        ];
        const orderBooks = [];
        
        for (const pair of pairs) {
            const book = await this.getOrderBook(pair);
            // Include all pairs, even if empty (so they show in dropdown)
            orderBooks.push(book);
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
