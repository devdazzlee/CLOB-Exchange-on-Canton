/**
 * OrderBook Service
 * Handles OrderBook-related business logic
 */

const config = require('../config');
const cantonService = require('./cantonService');
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
    return { packageId, moduleName, entityName };
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
   */
  async getOrderBookContractId(tradingPair) {
    const adminToken = await cantonService.getAdminToken();
    const contractId = await getOrderBookContractId(
      tradingPair,
      adminToken,
      config.canton.jsonApiBase
    );
    return contractId;
  }

  /**
   * Get OrderBook details with working filter structure
   */
  async getOrderBook(tradingPair) {
    const contractId = await this.getOrderBookContractId(tradingPair);
    
    if (!contractId) {
      throw new NotFoundError(`OrderBook not found for trading pair: ${tradingPair}`);
    }

    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=10`, {
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
                contractIds: [contractId],
              },
            },
          },
        },
      }),
    });

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
      throw new NotFoundError(`OrderBook contract not found: ${contractId}`);
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
  }

  /**
   * Get all OrderBooks with working filter structure
   */
  async getAllOrderBooks() {
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
  }

  /**
   * Get trades for a trading pair using working filter structure
   */
  async getTrades(tradingPair, limit = 100) {
    const cachedTrades = tradeStore.getTrades(tradingPair, limit);
    if (cachedTrades.length > 0) {
      return cachedTrades;
    }

    return [];
  }

  /**
   * Create OrderBook for a trading pair
   */
  async createOrderBook(tradingPair) {
    const adminToken = await cantonService.getAdminToken();
    
    // Check if OrderBook already exists
    const existingContractId = await this.getOrderBookContractId(tradingPair);
    if (existingContractId) {
      return {
        contractId: existingContractId,
        alreadyExists: true,
      };
    }

    // Parse trading pair
    const [base, quote] = tradingPair.split('/');
    if (!base || !quote) {
      throw new Error('Invalid trading pair format. Expected BASE/QUOTE');
    }

    // Get package ID for OrderBook template (use package-id format to avoid vetting issues)
    const orderBookPackageId = await cantonService.getPackageIdForTemplate('OrderBook', adminToken);

    // Create OrderBook contract (UTXO model)
    // Try without synchronizer first, then with synchronizer if needed
    let orderBookResult;
    try {
      orderBookResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: config.canton.operatorPartyId,
        templateId: `${orderBookPackageId}:OrderBook:OrderBook`,
        createArguments: {
          tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: config.canton.operatorPartyId,
          activeUsers: [],
          userAccounts: null,
        },
        readAs: [config.canton.operatorPartyId],
        synchronizerId: null, // Try without synchronizer first
      });
    } catch (syncError) {
      // If synchronizer is required, fall back to using it
      console.log('[OrderBook] Synchronizer required, using:', syncError.message);
      orderBookResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: config.canton.operatorPartyId,
        templateId: `${orderBookPackageId}:OrderBook:OrderBook`,
        createArguments: {
          tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: config.canton.operatorPartyId,
          activeUsers: [],
          userAccounts: null,
        },
        readAs: [config.canton.operatorPartyId],
        synchronizerId: await this.discoverSynchronizerId(),
      });
    }

    const orderBookContractId = orderBookResult.transaction?.events?.[0]?.created?.contractId;

    console.log('[OrderBook] Contract creation result:', JSON.stringify(orderBookResult, null, 2));
    console.log('[OrderBook] Contract ID:', orderBookContractId);

    if (!orderBookContractId) {
      throw new Error(`Failed to create OrderBook contract. Result: ${JSON.stringify(orderBookResult)}`);
    }

    return {
      contractId: orderBookContractId,
      masterOrderBookContractId: null,
      alreadyExists: false,
    };
  }
}

module.exports = new OrderBookService();
