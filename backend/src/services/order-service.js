/**
 * Order Service - REAL Canton integration ONLY
 * No in-memory fallbacks or fake data
 */

const config = require('../config');
const CantonLedgerClient = require('./cantonLedgerClient');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

class OrderService {
  constructor() {
    this.cantonClient = new CantonLedgerClient();
  }

  /**
   * Place order using REAL Canton integration
   * Follows the Canton JSON Ledger API v2 specification
   */
  async placeOrder(orderData) {
    const {
      partyId,
      tradingPair,
      orderType, // BUY | SELL
      orderMode, // LIMIT | MARKET
      price,
      quantity,
      timeInForce = 'GTC'
    } = orderData;

    // Validation
    if (!partyId || !tradingPair || !orderType || !orderMode || !quantity) {
      throw new ValidationError('Missing required fields: partyId, tradingPair, orderType, orderMode, quantity');
    }

    if (orderMode === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    console.log('[OrderService] Placing REAL order:', orderData);

    // Generate proper UUID for command ID
    const commandId = `place-order-${uuidv4()}`;

    // Create Order contract on Canton
    const command = {
      templateId: `${config.canton.packageIds.clobExchange}:Order:Order`,
      createArguments: {
        owner: partyId,
        tradingPair,
        orderType,
        orderMode,
        price: orderMode === 'LIMIT' ? price.toString() : null,
        quantity: quantity.toString(),
        timeInForce,
        status: 'OPEN',
        timestamp: new Date().toISOString()
      }
    };

    const result = await this.cantonClient.submitAndWaitForTransaction({
      command,
      actAs: [partyId],
      readAs: [config.canton.operatorPartyId]
    });

    // Extract created Order contract ID
    const orderEvent = result.transaction.events.find(e => 
      e.CreatedEvent?.templateId.includes('Order')
    );

    if (!orderEvent) {
      throw new Error('Order placement failed - no contract created');
    }

    const contractId = orderEvent.CreatedEvent.contractId;
    console.log(`[OrderService] Order placed successfully: ${contractId}`);

    return {
      success: true,
      orderId: contractId,
      status: 'OPEN',
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Cancel order using REAL Canton integration
   */
  async cancelOrder(orderContractId, partyId) {
    if (!orderContractId || !partyId) {
      throw new ValidationError('Order contract ID and party ID are required');
    }

    console.log(`[OrderService] Cancelling REAL order: ${orderContractId}`);

    // Generate proper UUID for command ID
    const commandId = `cancel-order-${uuidv4()}`;

    // Exercise Cancel choice on Order contract
    const command = {
      templateId: `${config.canton.packageIds.clobExchange}:Order:Order`,
      contractId: orderContractId,
      choice: 'Cancel',
      choiceArgument: {}
    };

    const result = await this.cantonClient.submitAndWaitForTransaction({
      command,
      actAs: [partyId],
      readAs: [config.canton.operatorPartyId]
    });

    console.log(`[OrderService] Order cancelled successfully: ${orderContractId}`);

    return {
      success: true,
      orderId: orderContractId,
      status: 'CANCELLED',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get user orders from REAL Canton state
   */
  async getUserOrders(partyId, status = 'OPEN', limit = 100) {
    if (!partyId) {
      throw new ValidationError('Party ID is required');
    }

    console.log(`[OrderService] Getting REAL orders for party: ${partyId}`);

    // Query Order contracts from Canton
    const activeContracts = await this.cantonClient.getActiveContracts({
      parties: [partyId],
      templateIds: [`${config.canton.packageIds.clobExchange}:Order:Order`]
    });

    if (!activeContracts.contractEntry) {
      return [];
    }

    const contracts = Array.isArray(activeContracts.contractEntry) 
      ? activeContracts.contractEntry 
      : [activeContracts.contractEntry];

    // Extract order data and filter by status
    const orders = contracts
      .filter(contract => contract.JsActiveContract)
      .map(contract => {
        const createdEvent = contract.JsActiveContract.createdEvent;
        return {
          orderId: createdEvent.contractId,
          partyId: createdEvent.argument.owner,
          tradingPair: createdEvent.argument.tradingPair,
          orderType: createdEvent.argument.orderType,
          orderMode: createdEvent.argument.orderMode,
          price: createdEvent.argument.price,
          quantity: createdEvent.argument.quantity,
          status: createdEvent.argument.status,
          timestamp: createdEvent.argument.timestamp
        };
      })
      .filter(order => status === 'ALL' || order.status === status)
      .slice(0, parseInt(limit));

    return orders;
  }

  /**
   * Get order details from REAL Canton state
   */
  async getOrder(orderContractId) {
    if (!orderContractId) {
      throw new ValidationError('Order contract ID is required');
    }

    console.log(`[OrderService] Getting REAL order: ${orderContractId}`);

    // Query specific Order contract from Canton
    const activeContracts = await this.cantonClient.getActiveContracts({
      contractIds: [orderContractId]
    });

    if (!activeContracts.contractEntry || !activeContracts.contractEntry.length) {
      throw new NotFoundError(`Order not found: ${orderContractId}`);
    }

    const contract = activeContracts.contractEntry[0].JsActiveContract;
    const createdEvent = contract.createdEvent;

    return {
      orderId: createdEvent.contractId,
      partyId: createdEvent.argument.owner,
      tradingPair: createdEvent.argument.tradingPair,
      orderType: createdEvent.argument.orderType,
      orderMode: createdEvent.argument.orderMode,
      price: createdEvent.argument.price,
      quantity: createdEvent.argument.quantity,
      status: createdEvent.argument.status,
      timestamp: createdEvent.argument.timestamp
    };
  }
}

module.exports = OrderService;
