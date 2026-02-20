/**
 * Read Model Service — Streaming-First with REST Fallback
 * 
 * PRIMARY: WebSocket streaming read model (bypasses 200-element limit)
 * FALLBACK: Direct Canton REST API queries (when streaming unavailable)
 * 
 * The streaming read model bootstraps from /v2/state/active-contracts (WebSocket)
 * and subscribes to /v2/updates (WebSocket) for real-time incremental updates.
 * This completely eliminates the 200-element REST API limit.
 */

const EventEmitter = require('events');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class ReadModelService extends EventEmitter {
    constructor(cantonService) {
        super();
        this.cantonService = cantonService;
        this.streamingModel = null;
    }

    async initialize() {
        // Try to initialize streaming read model first
        try {
            const { getStreamingReadModel } = require('./streamingReadModel');
            this.streamingModel = getStreamingReadModel();
            await this.streamingModel.initialize();
            console.log('[ReadModel] ✅ Streaming mode active — bypasses 200-element limit');
        } catch (err) {
            console.warn(`[ReadModel] ⚠️ Streaming init failed: ${err.message}`);
            console.warn('[ReadModel]   Falling back to direct Canton REST queries (200-element limit applies)');
            this.streamingModel = null;
        }
    }

    /**
     * Check if streaming mode is active
     */
    isStreaming() {
        return this.streamingModel?.isReady() || false;
    }

    /**
     * Query orders — streaming first, REST fallback
     */
    async queryOrdersFromCanton(tradingPair = null) {
        // PRIMARY: Streaming read model (no 200 limit)
        if (this.streamingModel?.isReady()) {
            const orders = tradingPair
                ? this.streamingModel.getOpenOrdersForPair(tradingPair)
                : this.streamingModel.getAllOpenOrders();
            return orders;
        }

        // FALLBACK: REST API (200 limit applies)
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;
        
        if (!packageId || !operatorPartyId) {
            return [];
        }

        const orderTemplateId = `${packageId}:Order:Order`;
        const contracts = await this.cantonService.queryActiveContracts({
            party: operatorPartyId,
            templateIds: [orderTemplateId],
            pageSize: 200
        }, token);

        const orders = (Array.isArray(contracts) ? contracts : [])
            .map(c => {
                const payload = c.payload || c.createArgument || {};
                return {
                    contractId: c.contractId,
                    orderId: payload.orderId,
                    owner: payload.owner,
                    orderType: payload.orderType,
                    orderMode: payload.orderMode,
                    tradingPair: payload.tradingPair,
                    price: payload.price,
                    quantity: payload.quantity,
                    filled: payload.filled,
                    status: payload.status,
                    timestamp: payload.timestamp
                };
            })
            .filter(o => o.status === 'OPEN');

        if (tradingPair) {
            return orders.filter(o => o.tradingPair === tradingPair);
        }
        return orders;
    }

    /**
     * Get order book for a trading pair — streaming first
     */
    async getOrderBook(tradingPair) {
        if (this.streamingModel?.isReady()) {
            return this.streamingModel.getOrderBook(tradingPair);
        }

        const orders = await this.queryOrdersFromCanton(tradingPair);
        
        const bids = orders
            .filter(o => o.orderType === 'BUY')
            .sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
        
        const asks = orders
            .filter(o => o.orderType === 'SELL')
            .sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
        
        return { bids, asks };
    }

    /**
     * Get order by ID
     */
    async getOrderById(orderId) {
        if (this.streamingModel?.isReady()) {
            const allOrders = this.streamingModel.getAllOpenOrders();
            return allOrders.find(o => o.orderId === orderId) || null;
        }

        const orders = await this.queryOrdersFromCanton();
        return orders.find(o => o.orderId === orderId) || null;
    }

    /**
     * Get order by contract ID
     */
    async getOrderByContractId(contractId) {
        if (this.streamingModel?.isReady()) {
            const allOrders = this.streamingModel.getAllOpenOrders();
            return allOrders.find(o => o.contractId === contractId) || null;
        }

        const orders = await this.queryOrdersFromCanton();
        return orders.find(o => o.contractId === contractId) || null;
    }

    /**
     * Get orders for a party
     */
    async getOrdersForParty(partyId) {
        if (this.streamingModel?.isReady()) {
            return this.streamingModel.getOrdersForParty(partyId);
        }

        const orders = await this.queryOrdersFromCanton();
        return orders.filter(o => o.owner === partyId);
    }

    /**
     * Get recent trades — streaming first, then file cache, then REST
     */
    getRecentTrades(tradingPair = null, limit = 50) {
        // PRIMARY: Streaming read model
        if (this.streamingModel?.isReady()) {
            return tradingPair
                ? this.streamingModel.getTradesForPair(tradingPair, limit)
                : this.streamingModel.getAllTrades(limit);
        }

        // FALLBACK: File-backed cache
        try {
            const { getUpdateStream } = require('./cantonUpdateStream');
            const updateStream = getUpdateStream();
            const trades = tradingPair
                ? updateStream.getTradesForPair(tradingPair, limit)
                : updateStream.getAllTrades(limit);
            return trades;
        } catch (e) {
            return [];
        }
    }

    /**
     * Get trades for a trading pair
     */
    async getTradesForPair(tradingPair) {
        return this.getRecentTrades(tradingPair, 100);
    }

    /**
     * Get all trades
     */
    async getAllTrades() {
        return this.getRecentTrades(null, 200);
    }

    /**
     * Get trades for a party
     */
    async getTradesForParty(partyId) {
        if (this.streamingModel?.isReady()) {
            return this.streamingModel.getTradesForParty(partyId);
        }

        const trades = this.getRecentTrades(null, 500);
        return trades.filter(t => t.buyer === partyId || t.seller === partyId);
    }

    /**
     * Get streaming stats for health check / monitoring
     */
    getStreamingStats() {
        if (this.streamingModel) {
            return this.streamingModel.getStats();
        }
        return { ready: false, mode: 'rest-only' };
    }

    // Compatibility methods (no-ops since there's no cache)
    stop() {
        if (this.streamingModel) {
            this.streamingModel.stop();
        }
    }
    addOrder() {}
    removeOrder() {}
    addTrade() {}
}

let instance = null;

function getReadModelService() {
    return instance;
}

function initializeReadModelService(cantonService) {
    if (!instance) {
        instance = new ReadModelService(cantonService);
    }
    return instance;
}

module.exports = {
    ReadModelService,
    getReadModelService,
    initializeReadModelService
};
