/**
 * Order Book Service — Streaming-First with REST Fallback
 * 
 * PRIMARY: WebSocket streaming read model (bypasses 200-element limit completely)
 * FALLBACK: Canton REST API with user-specific queries (when streaming unavailable)
 * 
 * The streaming read model (streamingReadModel.js) bootstraps via WebSocket from
 * /v2/state/active-contracts and subscribes to /v2/updates for real-time state.
 * This eliminates the 200-element REST API limit and provides instant queries.
 * 
 * Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/asyncapi.html
 */

const config = require('../config');
const { LEGACY_PACKAGE_ID } = require('../config/constants');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const { getGlobalOpenOrders } = require('./order-service');

class OrderBookService {
    constructor() {
        this.streamingModel = null;
        console.log('[OrderBookService] Initialized — streaming-first with REST fallback');
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
     * Streaming path: instant in-memory lookup (no REST, no 200 limit)
     * REST fallback: Canton REST API with operator + user-specific queries
     */
    async getOrderBook(tradingPair, userPartyId = null) {
        // ═══ PRIMARY: Streaming Read Model (no 200 limit) ═══
        const streaming = this._getStreamingModel();
        if (streaming) {
            const book = streaming.getOrderBook(tradingPair);
            return book;
        }

        // ═══ FALLBACK: REST API (200 limit applies) ═══
        console.log(`[OrderBookService] REST fallback for ${tradingPair}${userPartyId ? ` (user: ${userPartyId.substring(0, 30)}...)` : ''}`);
        
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;

        if (!packageId || !operatorPartyId) {
            console.warn('[OrderBookService] Missing packageId or operatorPartyId');
            return this.emptyOrderBook(tradingPair);
        }

        try {
            const token = await tokenProvider.getServiceToken();
            
            // Query Order contracts from Canton (both new and legacy packages)
            const templateIds = [`${packageId}:Order:Order`];
            if (LEGACY_PACKAGE_ID && LEGACY_PACKAGE_ID !== packageId) {
                templateIds.push(`${LEGACY_PACKAGE_ID}:Order:Order`);
            }
            
            // Primary query: operator party
            let contracts = await cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds,
                pageSize: 200
            }, token);
            
            // User-specific query: bypass the 200-element limit
            if (userPartyId && userPartyId !== operatorPartyId) {
                try {
                    const userContracts = await cantonService.queryActiveContracts({
                        party: userPartyId,
                        templateIds,
                        pageSize: 200
                    }, token);
                    
                    if (Array.isArray(userContracts) && userContracts.length > 0) {
                        const existingIds = new Set((Array.isArray(contracts) ? contracts : []).map(c => c.contractId));
                        const extra = userContracts.filter(c => !existingIds.has(c.contractId));
                        if (extra.length > 0) {
                            contracts = [...(Array.isArray(contracts) ? contracts : []), ...extra];
                        }
                    }
                } catch (userErr) {
                    console.warn(`[OrderBookService] User-specific query failed: ${userErr.message}`);
                }
            }

            // Merge with global open orders registry
            try {
                const globalOrders = getGlobalOpenOrders();
                if (Array.isArray(globalOrders) && globalOrders.length > 0) {
                    const existingIds = new Set((Array.isArray(contracts) ? contracts : []).map(c => c.contractId));
                    const extra = globalOrders
                        .filter(o => o.status === 'OPEN' && o.tradingPair === tradingPair && !existingIds.has(o.contractId))
                        .map(o => ({
                            contractId: o.contractId,
                            templateId: `${packageId}:Order:Order`,
                            payload: o,
                            createArgument: o,
                        }));
                    if (extra.length > 0) {
                        contracts = [...(Array.isArray(contracts) ? contracts : []), ...extra];
                    }
                }
            } catch (globalErr) {
                // Non-critical
            }

            const contractArray = Array.isArray(contracts) ? contracts : [];

            const buyOrders = [];
            const sellOrders = [];
            
            for (const c of contractArray) {
                const payload = c.payload || c.createArgument || {};
                
                if (payload.tradingPair !== tradingPair || payload.status !== 'OPEN') {
                    continue;
                }
                
                let rawPrice = payload.price;
                if (rawPrice && typeof rawPrice === 'object' && rawPrice.Some !== undefined) {
                    rawPrice = rawPrice.Some;
                }
                
                const order = {
                    contractId: c.contractId,
                    orderId: payload.orderId,
                    owner: payload.owner,
                    price: rawPrice,
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
            
            buyOrders.sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
            sellOrders.sort((a, b) => parseFloat(a.price || Infinity) - parseFloat(b.price || Infinity));

            return {
                tradingPair,
                buyOrders,
                sellOrders,
                lastPrice: null,
                timestamp: new Date().toISOString(),
                source: 'canton-rest-fallback'
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
     * Get trades — streaming-first with REST + cache fallback
     * 
     * PRIMARY: Streaming read model (in-memory, no 200 limit)
     * FALLBACK: File-backed cache + Canton REST API
     */
    async getTrades(tradingPair, limit = 50) {
        // ═══ PRIMARY: Streaming Read Model (no 200 limit) ═══
        const streaming = this._getStreamingModel();
        if (streaming) {
            const trades = streaming.getTradesForPair(tradingPair, limit);
            return trades;
        }

        // ═══ FALLBACK: File cache + REST API ═══
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds?.clobExchange;
        const legacyPackageId = config.canton.packageIds?.legacy;
        const operatorPartyId = config.canton.operatorPartyId;

        if (!packageId || !operatorPartyId) {
            return [];
        }

        const tradeMap = new Map();
        // Check file-backed cache first
        try {
            const { getUpdateStream } = require('./cantonUpdateStream');
            const updateStream = getUpdateStream();
            const cachedTrades = updateStream.getTradesForPair(tradingPair, limit * 2);
            for (const ct of cachedTrades) {
                const tid = ct.tradeId;
                if (tid) tradeMap.set(tid, ct);
            }
        } catch (e) { /* non-critical */ }

        try {
            // Current package: Settlement:Trade
            try {
                const currentContracts = await cantonService.queryActiveContracts({
                    party: operatorPartyId,
                    templateIds: [`${packageId}:Settlement:Trade`],
                    pageSize: Math.min(limit, 100)
                }, token);
                if (Array.isArray(currentContracts) && currentContracts.length > 0) {
                    for (const c of currentContracts) {
                        const payload = c.payload || c.createArgument || {};
                        const baseSymbol = payload.baseInstrumentId?.symbol || '';
                        const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
                        const pair = (baseSymbol && quoteSymbol)
                            ? `${baseSymbol}/${quoteSymbol}`
                            : (payload.tradingPair || '');
                        if (pair !== tradingPair) continue;
                        const tradeId = payload.tradeId || c.contractId;
                        tradeMap.set(tradeId, {
                            contractId: c.contractId, tradeId, tradingPair: pair,
                            buyer: payload.buyer, seller: payload.seller,
                            price: payload.price,
                            quantity: payload.baseAmount || payload.quantity,
                            quoteAmount: payload.quoteAmount,
                            buyOrderId: payload.buyOrderId, sellOrderId: payload.sellOrderId,
                            timestamp: payload.timestamp,
                        });
                    }
                }
            } catch (e) {
                console.warn(`[OrderBookService] Settlement:Trade query failed: ${e.message}`);
            }

            // Legacy package: Trade:Trade (if different)
            if (legacyPackageId && legacyPackageId !== packageId) {
                try {
                    const legacyContracts = await cantonService.queryActiveContracts({
                        party: operatorPartyId,
                        templateIds: [`${legacyPackageId}:Trade:Trade`],
                        pageSize: Math.min(limit, 100)
                    }, token);
                    if (Array.isArray(legacyContracts)) {
                        for (const c of legacyContracts) {
                            const payload = c.payload || c.createArgument || {};
                            const baseSymbol = payload.baseInstrumentId?.symbol || '';
                            const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
                            const pair = (baseSymbol && quoteSymbol)
                                ? `${baseSymbol}/${quoteSymbol}`
                                : (payload.tradingPair || '');
                            if (pair !== tradingPair) continue;
                            const tradeId = payload.tradeId || c.contractId;
                            if (!tradeMap.has(tradeId)) {
                                tradeMap.set(tradeId, {
                                    contractId: c.contractId, tradeId, tradingPair: pair,
                                    buyer: payload.buyer, seller: payload.seller,
                                    price: payload.price,
                                    quantity: payload.baseAmount || payload.quantity,
                                    quoteAmount: payload.quoteAmount,
                                    buyOrderId: payload.buyOrderId, sellOrderId: payload.sellOrderId,
                                    timestamp: payload.timestamp,
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[OrderBookService] Legacy Trade:Trade query failed: ${e.message}`);
                }
            }

            return [...tradeMap.values()]
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                .slice(0, limit);
        } catch (error) {
            console.error(`[OrderBookService] Trade query failed: ${error.message}`);
            return [...tradeMap.values()]
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                .slice(0, limit);
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
