/**
 * Real Order Book Service using Canton JSON Ledger API
 * 
 * This replaces the in-memory order book with proper blockchain integration.
 * All order book state comes from Canton contracts via WebSocket streaming.
 */

const CantonLedgerClient = require('./cantonLedgerClient');
const { NotFoundError } = require('../utils/errors');

class RealOrderBookService {
  constructor() {
    this.cantonClient = new CantonLedgerClient();
    this.orderBooks = new Map(); // tradingPair -> order book state
    this.orders = new Map(); // contractId -> order data
    this.trades = new Map(); // contractId -> trade data
    this.isInitialized = false;
    
    // Template IDs for DAML contracts
    this.orderBookTemplateId = 'MasterOrderBookV2:MasterOrderBookV2';
    this.orderTemplateId = 'Order:Order';
    this.tradeTemplateId = 'Trade:Trade';
    
    this.setupEventHandlers();
  }

  /**
   * Initialize the service - bootstrap from Canton then start streaming
   */
  async initialize() {
    try {
      console.log('[RealOrderBook] Initializing...');
      
      // Get current ledger end
      await this.cantonClient.getLedgerEnd();
      
      // Bootstrap existing contracts
      await this.bootstrapOrderBooks();
      
      // Start real-time streaming
      await this.startStreaming();
      
      this.isInitialized = true;
      console.log('[RealOrderBook] Initialization complete');
    } catch (error) {
      console.error('[RealOrderBook] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Bootstrap existing order books from Canton
   * Use active contracts query sparingly for initial state only
   */
  async bootstrapOrderBooks() {
    console.log('[RealOrderBook] Bootstrapping order books...');
    
    // Get all OrderBook contracts
    const activeContracts = await this.cantonClient.getActiveContracts({
      parties: [config.canton.operatorPartyId],
      templateIds: [this.orderBookTemplateId]
    });

    // Process existing order books
    if (activeContracts.contractEntry) {
      const contracts = Array.isArray(activeContracts.contractEntry) 
        ? activeContracts.contractEntry 
        : [activeContracts.contractEntry];

      for (const contract of contracts) {
        if (contract.JsActiveContract) {
          const createdEvent = contract.JsActiveContract.createdEvent;
          const orderBook = this.parseOrderBookContract(createdEvent);
          this.orderBooks.set(orderBook.tradingPair, orderBook);
          console.log(`[RealOrderBook] Bootstrapped order book: ${orderBook.tradingPair}`);
        }
      }
    }

    // Get all existing orders
    await this.bootstrapOrders();
    
    // Get all existing trades
    await this.bootstrapTrades();
  }

  async bootstrapOrders() {
    const activeContracts = await this.cantonClient.getActiveContracts({
      parties: [config.canton.operatorPartyId],
      templateIds: [this.orderTemplateId]
    });

    if (activeContracts.contractEntry) {
      const contracts = Array.isArray(activeContracts.contractEntry) 
        ? activeContracts.contractEntry 
        : [activeContracts.contractEntry];

      for (const contract of contracts) {
        if (contract.JsActiveContract) {
          const order = this.parseOrderContract(contract.JsActiveContract.createdEvent);
          this.orders.set(order.contractId, order);
          
          // Add to order book
          const orderBook = this.orderBooks.get(order.tradingPair);
          if (orderBook) {
            if (order.orderType === 'BUY') {
              orderBook.buyOrders.push(order);
            } else {
              orderBook.sellOrders.push(order);
            }
          }
        }
      }
    }
  }

  async bootstrapTrades() {
    const activeContracts = await this.cantonClient.getActiveContracts({
      parties: [config.canton.operatorPartyId],
      templateIds: [this.tradeTemplateId]
    });

    if (activeContracts.contractEntry) {
      const contracts = Array.isArray(activeContracts.contractEntry) 
        ? activeContracts.contractEntry 
        : [activeContracts.contractEntry];

      for (const contract of contracts) {
        if (contract.JsActiveContract) {
          const trade = this.parseTradeContract(contract.JsActiveContract.createdEvent);
          this.trades.set(trade.contractId, trade);
        }
      }
    }
  }

  /**
   * Start real-time WebSocket streaming
   */
  async startStreaming() {
    await this.cantonClient.connectUpdatesStream({
      parties: [config.canton.operatorPartyId],
      templateIds: [this.orderBookTemplateId, this.orderTemplateId, this.tradeTemplateId]
    });
  }

  /**
   * Setup event handlers for WebSocket updates
   */
  setupEventHandlers() {
    // Handle new contracts
    this.cantonClient.on('contractCreated', (event) => {
      console.log('[RealOrderBook] Contract created:', event.templateId);
      
      if (event.templateId.includes('MasterOrderBookV2')) {
        const orderBook = this.parseOrderBookContract(event);
        this.orderBooks.set(orderBook.tradingPair, orderBook);
      } else if (event.templateId.includes('Order')) {
        const order = this.parseOrderContract(event);
        this.orders.set(order.contractId, order);
        this.addOrderToOrderBook(order);
      } else if (event.templateId.includes('Trade')) {
        const trade = this.parseTradeContract(event);
        this.trades.set(trade.contractId, trade);
      }
    });

    // Handle archived contracts
    this.cantonClient.on('contractArchived', (event) => {
      console.log('[RealOrderBook] Contract archived:', event.templateId);
      
      if (event.templateId.includes('Order')) {
        const order = this.orders.get(event.contractId);
        if (order) {
          this.removeOrderFromOrderBook(order);
          this.orders.delete(event.contractId);
        }
      }
    });
  }

  /**
   * Create Order Book via Canton command
   */
  async createOrderBook(tradingPair, operatorPartyId) {
    if (this.orderBooks.has(tradingPair)) {
      throw new Error(`OrderBook already exists for ${tradingPair}`);
    }

    const command = {
      templateId: this.orderBookTemplateId,
      createArguments: {
        tradingPair,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        operator: operatorPartyId,
        publicObserver: operatorPartyId,
        activeUsers: [operatorPartyId],
        userAccounts: null
      }
    };

    const result = await this.cantonClient.submitAndWaitForTransaction({
      command,
      actAs: operatorPartyId
    });

    // Extract created OrderBook contract ID
    const orderBookEvent = result.transaction.events.find(e => 
      e.CreatedEvent?.templateId.includes('MasterOrderBookV2')
    );

    if (!orderBookEvent) {
      throw new Error('OrderBook creation failed - no contract created');
    }

    const contractId = orderBookEvent.CreatedEvent.contractId;
    console.log(`[RealOrderBook] OrderBook created: ${contractId}`);
    
    return {
      success: true,
      contractId,
      tradingPair
    };
  }

  /**
   * Place Order via Canton command
   */
  async placeOrder(orderData) {
    const { tradingPair, orderType, orderMode, price, quantity, partyId } = orderData;

    // Get OrderBook contract
    const orderBook = this.orderBooks.get(tradingPair);
    if (!orderBook) {
      throw new NotFoundError(`OrderBook not found for ${tradingPair}`);
    }

    const command = {
      templateId: this.orderTemplateId,
      createArguments: {
        orderBookId: orderBook.contractId,
        owner: partyId,
        orderType,
        orderMode,
        price: orderMode === 'LIMIT' ? price : null,
        quantity,
        timestamp: new Date().toISOString(),
        status: 'OPEN'
      }
    };

    const result = await this.cantonClient.submitAndWaitForTransaction({
      command,
      actAs: partyId,
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
    console.log(`[RealOrderBook] Order placed: ${contractId}`);
    
    return {
      success: true,
      contractId,
      status: 'OPEN'
    };
  }

  /**
   * Cancel Order via Canton command
   */
  async cancelOrder(orderContractId, partyId) {
    const order = this.orders.get(orderContractId);
    if (!order) {
      throw new NotFoundError(`Order not found: ${orderContractId}`);
    }

    const command = {
      templateId: order.templateId,
      contractId: orderContractId,
      choice: 'Cancel',
      argument: {}
    };

    const result = await this.cantonClient.submitAndWaitForTransaction({
      command,
      actAs: partyId,
      readAs: [config.canton.operatorPartyId]
    });

    console.log(`[RealOrderBook] Order cancelled: ${orderContractId}`);
    
    return {
      success: true,
      contractId: orderContractId,
      status: 'CANCELLED'
    };
  }

  /**
   * Get order book snapshot
   */
  getOrderBook(tradingPair) {
    const orderBook = this.orderBooks.get(tradingPair);
    if (!orderBook) {
      throw new NotFoundError(`OrderBook not found for ${tradingPair}`);
    }

    // Sort orders by price
    orderBook.buyOrders.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    orderBook.sellOrders.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return {
      tradingPair: orderBook.tradingPair,
      contractId: orderBook.contractId,
      buyOrders: orderBook.buyOrders,
      sellOrders: orderBook.sellOrders,
      lastPrice: orderBook.lastPrice,
      timestamp: orderBook.updatedAt
    };
  }

  /**
   * Get all order books
   */
  getAllOrderBooks() {
    return Array.from(this.orderBooks.values()).map(ob => ({
      tradingPair: ob.tradingPair,
      contractId: ob.contractId,
      buyOrderCount: ob.buyOrders.length,
      sellOrderCount: ob.sellOrders.length,
      lastPrice: ob.lastPrice,
      updatedAt: ob.updatedAt
    }));
  }

  /**
   * Get trades for a trading pair
   */
  getTrades(tradingPair, limit = 50) {
    const trades = Array.from(this.trades.values())
      .filter(trade => trade.tradingPair === tradingPair)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    return trades;
  }

  // Helper methods to parse contract data
  parseOrderBookContract(createdEvent) {
    // Parse the contract payload based on DAML structure
    return {
      contractId: createdEvent.contractId,
      templateId: createdEvent.templateId,
      tradingPair: createdEvent.argument.tradingPair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: createdEvent.argument.lastPrice,
      operator: createdEvent.argument.operator,
      contractData: createdEvent
    };
  }

  parseOrderContract(createdEvent) {
    return {
      contractId: createdEvent.contractId,
      templateId: createdEvent.templateId,
      tradingPair: createdEvent.argument.tradingPair,
      owner: createdEvent.argument.owner,
      orderType: createdEvent.argument.orderType,
      orderMode: createdEvent.argument.orderMode,
      price: createdEvent.argument.price,
      quantity: createdEvent.argument.quantity,
      status: createdEvent.argument.status,
      timestamp: createdEvent.argument.timestamp,
      contractData: createdEvent
    };
  }

  parseTradeContract(createdEvent) {
    return {
      contractId: createdEvent.contractId,
      templateId: createdEvent.templateId,
      tradingPair: createdEvent.argument.tradingPair,
      buyOrder: createdEvent.argument.buyOrder,
      sellOrder: createdEvent.argument.sellOrder,
      price: createdEvent.argument.price,
      quantity: createdEvent.argument.quantity,
      timestamp: createdEvent.argument.timestamp,
      contractData: createdEvent
    };
  }

  addOrderToOrderBook(order) {
    const orderBook = this.orderBooks.get(order.tradingPair);
    if (orderBook) {
      if (order.orderType === 'BUY') {
        orderBook.buyOrders.push(order);
      } else {
        orderBook.sellOrders.push(order);
      }
      orderBook.updatedAt = new Date().toISOString();
    }
  }

  removeOrderFromOrderBook(order) {
    const orderBook = this.orderBooks.get(order.tradingPair);
    if (orderBook) {
      if (order.orderType === 'BUY') {
        orderBook.buyOrders = orderBook.buyOrders.filter(o => o.contractId !== order.contractId);
      } else {
        orderBook.sellOrders = orderBook.sellOrders.filter(o => o.contractId !== order.contractId);
      }
      orderBook.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown() {
    console.log('[RealOrderBook] Shutting down...');
    this.cantonClient.disconnect();
    this.orderBooks.clear();
    this.orders.clear();
    this.trades.clear();
    this.isInitialized = false;
  }
}

module.exports = RealOrderBookService;
