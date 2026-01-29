/**
 * Order Book Service - Facade
 * 
 * This service acts as a facade that delegates to:
 * - ReadModelService for read operations (order books, trades)
 * - CantonService for write operations (place/cancel orders)
 * 
 * DEPRECATED: Direct use of this service is deprecated.
 * Use the ReadModelService and CantonService directly in new code.
 */

const config = require('../config');
const cantonService = require('./cantonService');
const { getReadModelService } = require('./readModelService');

class OrderBookService {
    constructor() {
        console.log('[OrderBookService] Initialized as facade for ReadModelService + CantonService');
    }

    /**
     * Get the ReadModelService singleton
     */
    getReadModel() {
        return getReadModelService();
    }

    /**
     * Get order book for a trading pair - queries Canton directly
     */
    async getOrderBook(tradingPair) {
        try {
            const tokenProvider = require('./tokenProvider');
            const token = await tokenProvider.getServiceToken();
            const packageId = config.canton.packageIds.clobExchange;
            const operatorPartyId = config.canton.operatorPartyId;

            if (!packageId) {
                throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
            }

            // Query MasterOrderBookV2 contracts
            const templateId = `${packageId}:MasterOrderBookV2:MasterOrderBookV2`;
            const contracts = await cantonService.queryActiveContracts({
                party: operatorPartyId,
                templateIds: [templateId]
            }, token);

            // Find the order book for this trading pair
            let orderBookContract = null;
            if (Array.isArray(contracts)) {
                orderBookContract = contracts.find(c => {
                    const payload = c.payload || c.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
                    return payload.tradingPair === tradingPair;
                });
            } else if (contracts.activeContracts) {
                orderBookContract = contracts.activeContracts.find(c => {
                    const payload = c.payload || c.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
                    return payload.tradingPair === tradingPair;
                });
            }

            if (!orderBookContract) {
                // Return empty order book if not found
                return {
                    tradingPair,
                    buyOrders: [],
                    sellOrders: [],
                    lastPrice: null,
                    timestamp: new Date().toISOString()
                };
            }

            // Extract order book data
            const payload = orderBookContract.payload || 
                          orderBookContract.contractEntry?.JsActiveContract?.createdEvent?.createArgument ||
                          orderBookContract.createArgument ||
                          {};

            const buyOrderCids = payload.buyOrders || [];
            const sellOrderCids = payload.sellOrders || [];
            const lastPrice = payload.lastPrice?.Some || payload.lastPrice || null;

            // Query actual order contracts
            const buyOrders = await this.queryOrders(buyOrderCids, token);
            const sellOrders = await this.queryOrders(sellOrderCids, token);

            return {
                tradingPair,
                buyOrders: buyOrders.filter(o => o.status === 'OPEN').map(o => ({
                    price: o.price?.Some || o.price || null,
                    quantity: o.quantity,
                    remaining: (parseFloat(o.quantity) - parseFloat(o.filled || 0)).toString(),
                    orderId: o.orderId,
                    owner: o.owner,
                    contractId: o.contractId
                })),
                sellOrders: sellOrders.filter(o => o.status === 'OPEN').map(o => ({
                    price: o.price?.Some || o.price || null,
                    quantity: o.quantity,
                    remaining: (parseFloat(o.quantity) - parseFloat(o.filled || 0)).toString(),
                    orderId: o.orderId,
                    owner: o.owner,
                    contractId: o.contractId
                })),
                lastPrice,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`[OrderBookService] Error getting order book for ${tradingPair}:`, error);
            // Return empty order book on error
            return {
                tradingPair,
                buyOrders: [],
                sellOrders: [],
                lastPrice: null,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Query order contracts by contract IDs
     */
    async queryOrders(orderCids, token) {
        if (!orderCids || orderCids.length === 0) {
            return [];
        }

        try {
            const packageId = config.canton.packageIds.clobExchange;
            const templateId = `${packageId}:Order:Order`;

            const contracts = await cantonService.queryActiveContracts({
                templateIds: [templateId]
            }, token);

            // Filter to only the requested contract IDs
            const orders = [];
            const cidSet = new Set(orderCids);
            
            const contractArray = Array.isArray(contracts) ? contracts : (contracts.activeContracts || []);
            
            for (const contract of contractArray) {
                const contractId = contract.contractId || 
                                 contract.contractEntry?.JsActiveContract?.createdEvent?.contractId;
                
                if (cidSet.has(contractId)) {
                    const payload = contract.payload || 
                                  contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument ||
                                  contract.createArgument ||
                                  {};
                    
                    orders.push({
                        contractId,
                        orderId: payload.orderId,
                        owner: payload.owner,
                        orderType: payload.orderType,
                        orderMode: payload.orderMode,
                        tradingPair: payload.tradingPair,
                        price: payload.price,
                        quantity: payload.quantity,
                        filled: payload.filled || '0',
                        status: payload.status,
                        timestamp: payload.timestamp
                    });
                }
            }

            return orders;
        } catch (error) {
            console.error('[OrderBookService] Error querying orders:', error);
            return [];
        }
    }

    /**
     * Get all order books
     * @deprecated Use ReadModelService.getAllOrderBooks() directly
     */
    getAllOrderBooks() {
        const readModel = this.getReadModel();
        if (!readModel) {
            return [];
        }

        return readModel.getAllOrderBooks().map(book => ({
            tradingPair: book.pair,
            buyOrders: book.bids || [],
            sellOrders: book.asks || [],
            lastPrice: book.lastPrice,
            timestamp: book.timestamp || new Date().toISOString()
        }));
    }

    /**
     * Get trades for a trading pair
     * @deprecated Use ReadModelService.getRecentTrades() directly
     */
    getTrades(tradingPair, limit = 50) {
        const readModel = this.getReadModel();
        if (!readModel) {
            return [];
        }

        return readModel.getRecentTrades(tradingPair, limit);
    }

    /**
     * Place an order on Canton ledger
     * @deprecated Use CantonService.createContractWithTransaction() directly
     */
    async placeOrder(orderData) {
        const {
            tradingPair,
            orderType, // BUY or SELL
            orderMode, // LIMIT or MARKET
            price,
            quantity,
            partyId
        } = orderData;

        if (!partyId) {
            throw new Error('placeOrder: partyId is required');
        }

        const tokenProvider = require('./tokenProvider');
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds.clobExchange;

        if (!packageId) {
            throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
        }

        const orderId = `O-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

        const result = await cantonService.createContractWithTransaction({
            token,
            actAsParty: partyId,
            templateId: `${packageId}:Order:Order`,
            createArguments: {
                orderId,
                owner: partyId,
                orderType: orderType.toUpperCase(),
                orderMode: orderMode.toUpperCase(),
                tradingPair,
                price: orderMode.toUpperCase() === 'LIMIT' && price ? { Some: price.toString() } : { None: null },
                quantity: quantity.toString(),
                filled: "0.0",
                status: "OPEN",
                timestamp: new Date().toISOString(),
                operator: config.canton.operatorPartyId,
                allocationCid: ""
            },
            readAs: [config.canton.operatorPartyId]
        });

        // Extract contract ID
        const createdEvent = result.transaction?.events?.find(e => e.created || e.CreatedEvent);
        const contractId = createdEvent?.created?.contractId ||
            createdEvent?.CreatedEvent?.contractId ||
            result.updateId;

        return {
            contractId,
            orderId,
            status: 'OPEN'
        };
    }

    /**
     * Cancel an order on Canton ledger
     * @deprecated Use CantonService.exerciseChoice() directly
     */
    async cancelOrder(orderId, partyId) {
        if (!orderId) {
            throw new Error('cancelOrder: orderId is required');
        }
        if (!partyId) {
            throw new Error('cancelOrder: partyId is required');
        }

        const readModel = this.getReadModel();
        const order = readModel?.getOrderByOrderId(orderId);

        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }

        const tokenProvider = require('./tokenProvider');
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds.clobExchange;

        await cantonService.exerciseChoice({
            token,
            actAsParty: partyId,
            templateId: `${packageId}:Order:Order`,
            contractId: order.contractId,
            choice: 'CancelOrder',
            choiceArgument: {},
            readAs: [config.canton.operatorPartyId]
        });

        return { status: 'CANCELLED' };
    }

    /**
     * Create an order book (creates MasterOrderBook contract)
     * @deprecated This should be an admin operation
     */
    async createOrderBook(tradingPair) {
        const tokenProvider = require('./tokenProvider');
        const token = await tokenProvider.getServiceToken();
        const packageId = config.canton.packageIds.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;

        // Check if order book already exists
        const readModel = this.getReadModel();
        const existingBook = readModel?.getOrderBook(tradingPair);

        if (existingBook && (existingBook.bids.length > 0 || existingBook.asks.length > 0)) {
            return {
                alreadyExists: true,
                tradingPair
            };
        }

        // Create MasterOrderBook contract
        const result = await cantonService.createContractWithTransaction({
            token,
            actAsParty: operatorPartyId,
            templateId: `${packageId}:MasterOrderBook:MasterOrderBook`,
            createArguments: {
                tradingPair,
                buyOrders: [],
                sellOrders: [],
                lastPrice: { None: null },
                operator: operatorPartyId,
                publicObserver: operatorPartyId,
                activeUsers: []
            },
            readAs: [operatorPartyId]
        });

        const createdEvent = result.transaction?.events?.find(e => e.created || e.CreatedEvent);
        const contractId = createdEvent?.created?.contractId ||
            createdEvent?.CreatedEvent?.contractId;

        return {
            contractId,
            masterOrderBookContractId: contractId,
            tradingPair,
            alreadyExists: false
        };
    }
}

// Singleton instance
module.exports = new OrderBookService();
