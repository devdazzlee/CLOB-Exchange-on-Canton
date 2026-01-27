/**
 * OrderBook Service
 * Handles OrderBook-related business logic
 */

const config = require('../config');
const cantonService = require('./cantonService');
const InMemoryOrderBookService = require('./inMemoryOrderBookService');
const { getOrderBookContractId } = require('./canton-api-helpers');
const tradeStore = require('./trade-store');
const { NotFoundError } = require('../utils/errors');

const MAX_BATCH_SIZE = 200;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

class OrderBookService {
  constructor() {
    this.orderBookCache = new Map();
    this.useInMemory = true; // Use in-memory service for now
    this.inMemoryService = new InMemoryOrderBookService();
  }

  cacheOrderBookId(tradingPair, contractId) {
    if (tradingPair && contractId) {
      this.orderBookCache.set(tradingPair, contractId);
    }
  }

  getCachedOrderBookId(tradingPair) {
    return this.orderBookCache.get(tradingPair);
  }

  extractCreatedContractId(updatePayload) {
    if (!updatePayload) {
      return null;
    }

    const candidateEvents = [
      updatePayload.events,
      updatePayload.transaction?.events,
      updatePayload.update?.events,
      updatePayload.update?.transaction?.events,
      updatePayload.transactions?.flatMap(t => t.events || [])
    ].flat().filter(Boolean);

    const createdEvent = candidateEvents.find(event => event?.created?.contractId);
    return createdEvent?.created?.contractId || null;
  }

  async fetchOrderDetails(orderIds, adminToken, activeAtOffset) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return [];
    }

    const batches = chunkArray(orderIds, MAX_BATCH_SIZE);
    const results = [];

    for (const batch of batches) {
      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=${batch.length}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          readAs: [config.canton.operatorPartyId],
          activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [config.canton.operatorPartyId]: {
                inclusive: {
                  contractIds: batch,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[OrderBookService] Fetch orders error details:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        throw new Error(`Failed to fetch orders: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const contracts = data.activeContracts || [];
      results.push(...contracts.map((entry) => {
        const contract = entry.contractEntry?.JsActiveContract?.createdEvent ||
          entry.createdEvent ||
          entry;
        const payload = contract.argument || contract.createArgument || {};
        const quantity = payload.quantity;
        const filled = payload.filled || 0;
        const remaining = quantity !== undefined ? Math.max(0, Number(quantity) - Number(filled || 0)) : undefined;

        return {
          contractId: contract.contractId,
          owner: payload.owner,
          price: payload.price,
          quantity,
          filled,
          remaining,
          timestamp: payload.timestamp,
          status: payload.status,
          orderType: payload.orderType,
          orderMode: payload.orderMode,
          tradingPair: payload.tradingPair,
        };
      }));
    }

    return results;
  }

  async discoverSynchronizerId() {
    try {
      if (config.canton.synchronizerId) {
        return config.canton.synchronizerId;
      }

      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/connected-synchronizers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await cantonService.getAdminToken()}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to discover synchronizerId: ${response.status} - ${errorText}`);
      }

      const data = await response.json().catch(() => ({}));
      let synchronizerId = null;

      if (data.connectedSynchronizers && Array.isArray(data.connectedSynchronizers) && data.connectedSynchronizers.length > 0) {
        const synchronizers = data.connectedSynchronizers;
        const globalSync = synchronizers.find(s =>
          s.synchronizerAlias === 'global' || s.alias === 'global'
        );
        if (globalSync?.synchronizerId) {
          synchronizerId = globalSync.synchronizerId;
        } else {
          const globalDomainSync = synchronizers.find(s =>
            s.synchronizerId && s.synchronizerId.includes('global-domain')
          );
          synchronizerId = globalDomainSync?.synchronizerId || synchronizers[0].synchronizerId || synchronizers[0].id;
        }
      } else if (data.synchronizers && Array.isArray(data.synchronizers) && data.synchronizers.length > 0) {
        const first = data.synchronizers[0];
        synchronizerId = typeof first === 'string' ? first : (first.synchronizerId || first.id);
      } else if (data.synchronizerId) {
        synchronizerId = data.synchronizerId;
      } else if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        synchronizerId = typeof first === 'string' ? first : (first.synchronizerId || first.id);
      }

      if (synchronizerId) {
        return synchronizerId;
      }

      throw new Error('No synchronizers found');
    } catch (error) {
      console.error('[OrderBookService] Failed to discover synchronizer:', error);
      throw error;
    }
  }

  buildTemplateId(moduleName, entityName) {
    const packageId = config.canton.packageIds?.clobExchange;
    if (!packageId) {
      throw new Error(`Missing package ID for ${moduleName}:${entityName}`);
    }
    return `${packageId}:${moduleName}:${entityName}`;
  }

  getMasterOrderBookTemplateId() {
    return this.buildTemplateId('MasterOrderBook', 'MasterOrderBook');
  }

  getOrderBookTemplateId() {
    return this.buildTemplateId('OrderBook', 'OrderBook');
  }

  getTradeTemplateId() {
    return this.buildTemplateId('Trade', 'Trade');
  }

  /**
   * Get OrderBook contract ID for a trading pair
   * @param {string} tradingPair - The trading pair
   * @returns {Promise<string|null>} - Contract ID or null if not found
   */
  async getOrderBookContractId(tradingPair) {
    // Try in-memory service first
    if (this.useInMemory) {
      return this.inMemoryService.getOrderBookContractId(tradingPair);
    }

    // Original DAML code (commented out for now)
    /*
    const adminToken = await cantonService.getAdminToken();
    return await getOrderBookContractId(tradingPair, adminToken, config.canton.jsonApiBase);
    */
    return null;
  }

  /**
   * Get trades for a trading pair
   * @param {string} tradingPair - The trading pair
   * @param {number} limit - Maximum number of trades to return
   * @returns {Promise<Array>} - Array of trades
   */
  async getTrades(tradingPair, limit = 50) {
    // Use in-memory service
    if (this.useInMemory) {
      return this.inMemoryService.getTrades(tradingPair, limit);
    }

    // Original DAML code (commented out for now)
    /*
    const adminToken = await cantonService.getAdminToken();
    const contractId = await this.getOrderBookContractId(tradingPair);
    
    if (!contractId) {
      throw new NotFoundError(`OrderBook not found for trading pair: ${tradingPair}`);
    }

    // Query trades from the ledger
    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        activeAtOffset: "0",
        verbose: true,
        filter: {
          filtersForAnyParty: {
            inclusive: {
              templateIds: [this.getTradeTemplateId()]
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trades: ${response.statusText}`);
    }

    const data = await response.json();
    const trades = data.activeContracts || [];
    
    // Filter trades for this trading pair and sort by timestamp
    return trades
      .map(trade => {
        const contractData = trade.contractEntry?.JsActiveContract?.createdEvent || trade.createdEvent || trade;
        return {
          tradeId: contractData.createArgument?.tradeId || contractData.argument?.tradeId,
          buyer: contractData.createArgument?.buyer || contractData.argument?.buyer,
          seller: contractData.createArgument?.seller || contractData.argument?.seller,
          tradingPair: contractData.createArgument?.tradingPair || contractData.argument?.tradingPair,
          price: contractData.createArgument?.price || contractData.argument?.price,
          quantity: contractData.createArgument?.quantity || contractData.argument?.quantity,
          timestamp: contractData.createArgument?.timestamp || contractData.argument?.timestamp,
          buyOrderId: contractData.createArgument?.buyOrderId || contractData.argument?.buyOrderId,
          sellOrderId: contractData.createArgument?.sellOrderId || contractData.argument?.sellOrderId
        };
      })
      .filter(trade => trade.tradingPair === tradingPair)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
    */
    return [];
  }
  async getOrderBook(tradingPair) {
    // Use in-memory service if available
    if (this.useInMemory) {
      console.log(`[OrderBook] Getting OrderBook ${tradingPair} from in-memory service`);
      const orderBook = this.inMemoryService.getOrderBookWithOrders(tradingPair);
      if (!orderBook) {
        throw new NotFoundError(`OrderBook not found for trading pair: ${tradingPair}`);
      }
      return orderBook;
    }

    // Original Canton ledger code (commented out for now)
    const contractId = await this.getOrderBookContractId(tradingPair);
    
    if (!contractId) {
      throw new NotFoundError(`OrderBook not found for trading pair: ${tradingPair}`);
    }

    if (contractId.startsWith('pending-')) {
      return {
        contractId,
        tradingPair,
        operator: null,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        userAccounts: {},
      };
    }

    return null; // Not implemented for in-memory mode
    /*
    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=10`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
              inclusive: {
                contractIds: [contractId],
              },
            },
          },
        }),
      });
    /*
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OrderBookService] GetOrderBook error details:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        contractId: contractId,
        operatorPartyId: config.canton.operatorPartyId
      });
      throw new Error(`Failed to fetch OrderBook: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];
    
    if (contracts.length === 0) {
      return {
        contractId,
        tradingPair,
        operator: null,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        userAccounts: {},
      };
    }

    const contract = contracts[0].contractEntry?.JsActiveContract?.createdEvent ||
      contracts[0].createdEvent ||
      contracts[0];
    const args = contract.argument || contract.createArgument || {};
    const buyOrderIds = args.buyOrders || [];
    const sellOrderIds = args.sellOrders || [];

    const orderDetails = await this.fetchOrderDetails(
      [...buyOrderIds, ...sellOrderIds],
      adminToken,
      activeAtOffset
    );
    const orderById = new Map(orderDetails.map((o) => [o.contractId, o]));
    const buyOrders = buyOrderIds.map((cid) => orderById.get(cid)).filter(Boolean);
    const sellOrders = sellOrderIds.map((cid) => orderById.get(cid)).filter(Boolean);

    return {
      contractId: contract.contractId,
      tradingPair: args.tradingPair,
      operator: args.operator,
      buyOrders,
      sellOrders,
      lastPrice: args.lastPrice,
      userAccounts: args.userAccounts || {},
    };
    */
  }

  /**
   * Get all OrderBooks with working filter structure
   */
  async getAllOrderBooks() {
    // Use in-memory service if available
    if (this.useInMemory) {
      console.log('[OrderBook] Getting all OrderBooks from in-memory service');
      const orderBooks = [];
      for (const [tradingPair, orderBook] of this.inMemoryService.orderBooks) {
        orderBooks.push({
          contractId: orderBook.contractId,
          tradingPair: orderBook.tradingPair,
          operator: orderBook.operator,
          buyOrders: orderBook.buyOrders,
          sellOrders: orderBook.sellOrders,
          lastPrice: orderBook.lastPrice,
          userAccounts: orderBook.userAccounts,
          createdAt: orderBook.createdAt,
          updatedAt: orderBook.updatedAt
        });
      }
      return orderBooks;
    }

    // Original Canton ledger code (commented out for now)
    return [];
    /*
    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=20`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        readAs: [config.canton.operatorPartyId],
        activeAtOffset,
        verbose: false,
        filter: {
          filtersByParty: {
            [config.canton.operatorPartyId]: {
              inclusive: {
                templateIds: [this.getOrderBookTemplateId()],
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OrderBookService] Query error details:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        operatorPartyId: config.canton.operatorPartyId
      });
      throw new Error(`Failed to fetch OrderBooks: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    return contracts.map(entry => {
      const contract = entry.contractEntry?.JsActiveContract?.createdEvent || 
                       entry.createdEvent || 
                       entry;
      const args = contract.argument || contract.createArgument || {};
      
      return {
        contractId: contract.contractId,
        tradingPair: args.tradingPair,
        operator: args.operator,
        buyOrdersCount: (args.buyOrders || []).length,
        sellOrdersCount: (args.sellOrders || []).length,
        lastPrice: args.lastPrice,
      };
    });
    */
  }

  /**
   * Create a new OrderBook for a trading pair
   * @param {string} tradingPair - The trading pair (e.g., "BTC/USDT")
   * @returns {Promise<Object>} - Result with OrderBook contract ID
   */
  async createOrderBook(tradingPair) {
    console.log(`[OrderBook] Creating OrderBook for ${tradingPair}`);
    
    // Check if OrderBook already exists (in-memory)
    const existingContractId = await this.getOrderBookContractId(tradingPair);
    if (existingContractId) {
      console.log(`[OrderBook] OrderBook already exists: ${existingContractId}`);
      return {
        success: true,
        message: 'OrderBook already exists',
        data: {
          contractId: existingContractId,
          masterOrderBookContractId: null,
          tradingPair: tradingPair,
          alreadyExists: true,
        },
      };
    }

    // Use in-memory service for now
    if (this.useInMemory) {
      console.log('[OrderBook] Using in-memory OrderBook service');
      return this.inMemoryService.createOrderBook(tradingPair, config.canton.operatorPartyId);
    }

    // Original DAML code (commented out for now)
    /*
    const adminToken = await cantonService.getAdminToken();
    
    // Parse trading pair
    const [base, quote] = tradingPair.split('/');
    if (!base || !quote) {
      throw new Error('Invalid trading pair format. Expected BASE/QUOTE');
    }

    // Get package ID for MasterOrderBookV2 template
    const orderBookPackageId = await cantonService.getPackageIdForTemplate('MasterOrderBookV2', adminToken);

    // Create OrderBook contract
    let orderBookResult;
    try {
      console.log('[OrderBook] Starting contract creation with templateId:', `${orderBookPackageId}:MasterOrderBookV2:MasterOrderBookV2`);
      
      orderBookResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: config.canton.operatorPartyId,
        templateId: `${orderBookPackageId}:MasterOrderBookV2:MasterOrderBookV2`,
        createArguments: {
          tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: config.canton.operatorPartyId,
          publicObserver: config.canton.operatorPartyId,
          activeUsers: [],
          userAccounts: null
        },
        readAs: [config.canton.operatorPartyId],
        synchronizerId: null
      });
    } catch (syncError) {
      // Retry with synchronizer
      orderBookResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: config.canton.operatorPartyId,
        templateId: `${orderBookPackageId}:MasterOrderBookV2:MasterOrderBookV2`,
        createArguments: {
          tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: config.canton.operatorPartyId,
          publicObserver: config.canton.operatorPartyId,
          activeUsers: [],
          userAccounts: null
        },
        readAs: [config.canton.operatorPartyId],
        synchronizerId: config.canton.synchronizerId
      });
    }

    const orderBookContractId = orderBookResult.transaction?.events?.[0]?.created?.contractId;

    // Wait for OrderBook to become visible and cache it
    await this.waitForOrderBookVisibility(tradingPair, orderBookContractId, adminToken);

    return {
      contractId: orderBookContractId,
      masterOrderBookContractId: null,
      alreadyExists: false,
    };
    */
  }
}

module.exports = new OrderBookService();
