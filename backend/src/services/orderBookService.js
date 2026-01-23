/**
 * OrderBook Service
 * Handles OrderBook-related business logic
 */

const config = require('../config');
const cantonService = require('./cantonService');
const { getOrderBookContractId } = require('./canton-api-helpers');
const { NotFoundError } = require('../utils/errors');

class OrderBookService {
  async discoverSynchronizerId() {
    try {
      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/connected-synchronizers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await cantonService.getAdminToken()}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const synchronizers = data.synchronizers || [];
        if (synchronizers.length > 0) {
          return synchronizers[0]; // Return first synchronizer
        }
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

    return {
      contractId: contract.contractId,
      tradingPair: contract.argument?.tradingPair || contract.createArgument?.tradingPair,
      operator: contract.argument?.operator || contract.createArgument?.operator,
      buyOrders: contract.argument?.buyOrders || contract.createArgument?.buyOrders || [],
      sellOrders: contract.argument?.sellOrders || contract.createArgument?.sellOrders || [],
      lastPrice: contract.argument?.lastPrice || contract.createArgument?.lastPrice,
      userAccounts: contract.argument?.userAccounts || contract.createArgument?.userAccounts || {},
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
  async getTrades(tradingPair) {
    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=100`, {
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
                templateIds: [this.getTradeTemplateId()],
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OrderBookService] GetTrades error details:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        tradingPair: tradingPair,
        operatorPartyId: config.canton.operatorPartyId
      });
      throw new Error(`Failed to fetch trades: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    // Normalize and filter by trading pair
    return contracts.map(entry => {
      const contract = entry.contractEntry?.JsActiveContract?.createdEvent || 
                       entry.createdEvent || 
                       entry;
      const payload = contract.argument || contract.createArgument || {};
      
      return {
        contractId: contract.contractId,
        tradingPair: payload.tradingPair,
        buyOrderCid: payload.buyOrderCid,
        sellOrderCid: payload.sellOrderCid,
        price: payload.price,
        quantity: payload.quantity,
        timestamp: payload.timestamp,
      };
    }).filter(trade => trade.tradingPair === tradingPair);
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

    // Create MasterOrderBook contract first
    const masterOrderBookResult = await cantonService.createContract({
      token: adminToken,
      actAsParty: config.canton.operatorPartyId,
      templateId: "#clob-exchange-splice:MasterOrderBook:MasterOrderBook",
      createArguments: {
        tradingPair,
        base,
        quote,
      },
      readAs: [config.canton.operatorPartyId],
      synchronizerId: await this.discoverSynchronizerId(),
    });

    // Extract MasterOrderBook contract ID
    const masterOrderBookContractId = masterOrderBookResult.transaction?.events?.[0]?.created?.contractId;
    
    if (!masterOrderBookContractId) {
      throw new Error('Failed to create MasterOrderBook contract');
    }

    // Create OrderBook contract
    const orderBookResult = await cantonService.createContract({
      token: adminToken,
      actAsParty: config.canton.operatorPartyId,
      templateId: "#clob-exchange-splice:OrderBook:OrderBook",
      createArguments: {
        masterOrderBook: masterOrderBookContractId,
        tradingPair,
        base,
        quote,
      },
      readAs: [config.canton.operatorPartyId],
      synchronizerId: await this.discoverSynchronizerId(),
    });

    const orderBookContractId = orderBookResult.transaction?.events?.[0]?.created?.contractId;

    if (!orderBookContractId) {
      throw new Error('Failed to create OrderBook contract');
    }

    return {
      contractId: orderBookContractId,
      masterOrderBookContractId,
      alreadyExists: false,
    };
  }
}

module.exports = new OrderBookService();
