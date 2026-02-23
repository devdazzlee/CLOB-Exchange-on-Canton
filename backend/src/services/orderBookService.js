/**
 * Order Book Service — WebSocket Streaming Only
 * 
 * Source of truth: WebSocket streaming read model (bypasses the 200-element limit).
 * 
 * The streaming read model (streamingReadModel.js) bootstraps via WebSocket from
 * /v2/state/active-contracts and subscribes to /v2/updates for real-time state.
 * This eliminates the 200-element REST API limit and provides instant queries.
 * 
 * Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/asyncapi.html
 */

class OrderBookService {
    constructor() {
        this.streamingModel = null;
        console.log('[OrderBookService] Initialized — WebSocket streaming only');
    }

    /**
     * Get the streaming read model (lazy init)
     */
    _getStreamingModel() {
        if (!this.streamingModel) {
            try {
                const { getStreamingReadModel } = require('./streamingReadModel');
                this.streamingModel = getStreamingReadModel();
            } catch (_) { /* streaming not available */ }
        }
        return this.streamingModel?.isReady() ? this.streamingModel : null;
    }

    /**
     * Get order book for a trading pair
     * 
     * Instant in-memory lookup from the WebSocket-synced read model.
     */
    async getOrderBook(tradingPair, userPartyId = null) {
        const streaming = this._getStreamingModel();
        if (streaming) {
            const book = streaming.getOrderBook(tradingPair);
            return book;
        }
        if (userPartyId) {
            console.warn(`[OrderBookService] Streaming model not ready yet for ${tradingPair} (user: ${userPartyId.substring(0, 30)}...)`);
        } else {
            console.warn(`[OrderBookService] Streaming model not ready yet for ${tradingPair}`);
        }
        return this.emptyOrderBook(tradingPair, 'websocket-not-ready');
    }

    /**
     * Return empty order book structure
     */
    emptyOrderBook(tradingPair, source = 'empty') {
            return {
                tradingPair,
                buyOrders: [],
                sellOrders: [],
                lastPrice: null,
            timestamp: new Date().toISOString(),
            source
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
     * Get trades from WebSocket streaming read model
     */
    async getTrades(tradingPair, limit = 50) {
        const streaming = this._getStreamingModel();
        if (streaming) {
            return streaming.getTradesForPair(tradingPair, limit);
        }
        return [];
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
