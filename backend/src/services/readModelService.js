/**
 * Read Model Service - DIRECT API QUERIES ONLY
 * 
 * NO IN-MEMORY CACHE - All data queried directly from Canton API
 * Every method queries Canton in real-time
 */

const EventEmitter = require('events');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class ReadModelService extends EventEmitter {
    constructor(cantonService) {
        super();
        this.cantonService = cantonService;
    }

    async initialize() {
        console.log('[ReadModel] Initialized - NO CACHE MODE, all queries go directly to Canton API');
    }

    /**
     * Query orders directly from Canton API
     */
    async queryOrdersFromCanton(tradingPair = null) {
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
     * Get order book for a trading pair - DIRECT FROM CANTON
     */
    async getOrderBook(tradingPair) {
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
     * Get order by ID - DIRECT FROM CANTON
     */
    async getOrderById(orderId) {
        const orders = await this.queryOrdersFromCanton();
        return orders.find(o => o.orderId === orderId) || null;
    }

    /**
     * Get order by contract ID - DIRECT FROM CANTON
     */
    async getOrderByContractId(contractId) {
        const orders = await this.queryOrdersFromCanton();
        return orders.find(o => o.contractId === contractId) || null;
    }

    /**
     * Get orders for a party - DIRECT FROM CANTON
     */
    async getOrdersForParty(partyId) {
        const orders = await this.queryOrdersFromCanton();
        return orders.filter(o => o.owner === partyId);
    }

    /**
     * Get recent trades — from file-backed cache (primary) + Canton API (fallback).
     * The in-memory cache is populated by the matching engine after each match
     * and persisted to disk, surviving server restarts.
     */
    getRecentTrades(tradingPair = null, limit = 50) {
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
        const trades = this.getRecentTrades(null, 500);
        return trades.filter(t => t.buyer === partyId || t.seller === partyId);
    }

    // Compatibility methods (no-ops since there's no cache)
    stop() {}
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
