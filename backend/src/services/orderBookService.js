/**
 * Order Book Service — Live Canton Queries
 *
 * Source of truth: Canton ledger (no in-memory orderbook cache).
 * Every request queries active Order contracts and builds a fresh book.
 */

const config = require('../config');
const tokenProvider = require('./tokenProvider');
const cantonService = require('./cantonService');
const { TEMPLATE_IDS } = require('../config/constants');
const { getTokenSystemType } = require('../config/canton-sdk.config');

class OrderBookService {
    constructor() {
        console.log('[OrderBookService] Initialized — live Canton query mode');
    }

    /**
     * Get order book for a trading pair
     */
    async getOrderBook(tradingPair, userPartyId = null) {
        const token = await tokenProvider.getServiceToken();
        const operatorPartyId = config.canton.operatorPartyId;
        if (!operatorPartyId) {
            return this.emptyOrderBook(tradingPair, 'missing-operator-party');
        }

        const templateIds = [
            TEMPLATE_IDS.orderNew,
            TEMPLATE_IDS.order,
        ];

        const contracts = await cantonService.queryActiveContracts({
            party: operatorPartyId,
            templateIds,
            pageSize: 500,
        }, token);

        const now = Date.now();
        const MAX_UTILITY_ALLOCATION_AGE_MS = 24 * 60 * 60 * 1000;
        const MAX_SPLICE_ALLOCATION_AGE_MS = 15 * 60 * 1000;

        const openOrders = (Array.isArray(contracts) ? contracts : [])
            .map((c) => {
                const payload = c.payload || c.createArgument || {};
                const qty = parseFloat(payload.quantity || '0');
                const filled = parseFloat(payload.filled || '0');
                const remaining = qty - filled;
                const rawPrice = payload.price?.Some ?? payload.price ?? null;
                return {
                    contractId: c.contractId,
                    owner: payload.owner,
                    orderId: payload.orderId,
                    tradingPair: payload.tradingPair,
                    orderType: payload.orderType,
                    orderMode: payload.orderMode,
                    status: payload.status,
                    price: rawPrice,
                    quantity: payload.quantity,
                    filled: payload.filled,
                    remaining,
                    timestamp: payload.timestamp,
                };
            })
            .filter((o) =>
                o.tradingPair === tradingPair &&
                o.status === 'OPEN' &&
                Number.isFinite(o.remaining) &&
                o.remaining > 0.0000001
            )
            .filter((o) => {
                // Keep orderbook aligned with matcher: exclude orders whose locked allocation
                // is guaranteed expired and therefore cannot settle.
                const [baseAsset, quoteAsset] = String(o.tradingPair || '').split('/');
                const side = String(o.orderType || '').toUpperCase();
                const lockedAsset = side === 'BUY' ? quoteAsset : baseAsset;
                const lockedAssetType = lockedAsset ? getTokenSystemType(lockedAsset) : null;
                const maxAgeMs = lockedAssetType === 'splice'
                    ? MAX_SPLICE_ALLOCATION_AGE_MS
                    : MAX_UTILITY_ALLOCATION_AGE_MS;
                const orderAgeMs = o.timestamp ? (now - new Date(o.timestamp).getTime()) : Infinity;
                return Number.isFinite(orderAgeMs) && orderAgeMs <= maxAgeMs;
            });

        const buyOrders = openOrders
            .filter((o) => o.orderType === 'BUY')
            .sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));

        const sellOrders = openOrders
            .filter((o) => o.orderType === 'SELL')
            .sort((a, b) => parseFloat(a.price || Infinity) - parseFloat(b.price || Infinity));

        return {
            tradingPair,
            buyOrders,
            sellOrders,
            lastPrice: null,
            timestamp: new Date().toISOString(),
            source: 'canton-live-query',
            ...(userPartyId ? { userPartyId } : {}),
        };
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

    async getTrades(tradingPair, limit = 50) {
        const token = await tokenProvider.getServiceToken();
        const operatorPartyId = config.canton.operatorPartyId;
        if (!operatorPartyId) return [];

        const tradeTemplateIds = [
            TEMPLATE_IDS.trade,
            TEMPLATE_IDS.legacyTrade,
        ];
        const contracts = await cantonService.queryActiveContracts({
            party: operatorPartyId,
            templateIds: tradeTemplateIds,
            pageSize: 500,
        }, token);

        return (Array.isArray(contracts) ? contracts : [])
            .map((c) => {
                const p = c.payload || c.createArgument || {};
                return {
                    contractId: c.contractId,
                    tradeId: p.tradeId,
                    tradingPair: p.tradingPair || p.pair,
                    buyer: p.buyer,
                    seller: p.seller,
                    price: p.price,
                    amount: p.amount || p.quantity,
                    quantity: p.quantity || p.amount,
                    timestamp: p.timestamp,
                };
            })
            .filter((t) => t.tradingPair === tradingPair)
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
            .slice(0, limit);
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
