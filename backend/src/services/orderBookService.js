/**
 * OrderBook Service
 * Handles OrderBook-related business logic
 */

const config = require('../config');
const cantonService = require('./cantonService');
const { getOrderBookContractId } = require('./canton-api-helpers');
const { NotFoundError } = require('../utils/errors');

class OrderBookService {
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
   * Get OrderBook details
   */
  async getOrderBook(tradingPair) {
    const contractId = await this.getOrderBookContractId(tradingPair);
    
    if (!contractId) {
      throw new NotFoundError(`OrderBook not found for trading pair: ${tradingPair}`);
    }

    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        readAs: [config.canton.operatorPartyId],
        activeAtOffset,
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
      throw new Error(`Failed to fetch OrderBook: ${response.status}`);
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
   * Get all OrderBooks
   */
  async getAllOrderBooks() {
    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        readAs: [config.canton.operatorPartyId],
        activeAtOffset,
        filter: {
          filtersByParty: {
            [config.canton.operatorPartyId]: {
              inclusive: {
                templateIds: ['OrderBook:OrderBook'],
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch OrderBooks: ${response.status}`);
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
    const masterOrderBookResult = await cantonService.createContract(
      adminToken,
      'MasterOrderBook:MasterOrderBook',
      {
        tradingPair,
        base,
        quote,
      }
    );

    // Extract MasterOrderBook contract ID
    const masterOrderBookContractId = masterOrderBookResult.transaction?.events?.[0]?.created?.contractId;
    
    if (!masterOrderBookContractId) {
      throw new Error('Failed to create MasterOrderBook contract');
    }

    // Create OrderBook contract
    const orderBookResult = await cantonService.createContract(
      adminToken,
      'OrderBook:OrderBook',
      {
        tradingPair,
        operator: config.canton.operatorPartyId,
        buyOrders: [],
        sellOrders: [],
        userAccounts: {},
        lastPrice: null,
      }
    );

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
