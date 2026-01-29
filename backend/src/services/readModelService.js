/**
 * Read Model Service - Simplified version
 */

const EventEmitter = require('events');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class ReadModelService extends EventEmitter {
    constructor(cantonService) {
        super();
        this.cantonService = cantonService;
        this.orderBooks = new Map();
        this.orders = new Map();
        this.trades = new Map();
    }

    async initialize() {
        console.log('[ReadModel] Initializing...');
        // Simplified initialization - skip bootstrap for now
        console.log('[ReadModel] ✅ Initialization complete (simplified)');
    }

    getOrderBook(tradingPair) {
        return this.orderBooks.get(tradingPair) || { bids: [], asks: [], lastPrice: null };
    }

    getUserOrders(partyId, options = {}) {
        return [];
    }

    getRecentTrades(pair = null, limit = 50) {
        return [];
    }

    getAllOrderBooks() {
        return [];
    }

    getOrderByContractId(contractId) {
        return null;
    }

    async shutdown() {
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

module.exports = {
    ReadModelService,
    getReadModelService
};
