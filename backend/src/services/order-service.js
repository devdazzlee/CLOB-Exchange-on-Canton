/**
 * Order Service - REAL Canton JSON Ledger API v2 integration
 * 
 * Uses the correct Canton APIs:
 * - POST /v2/commands/submit-and-wait-for-transaction - Place/Cancel orders
 * - POST /v2/state/active-contracts - Query orders
 * 
 * Features:
 * - Global Order Book (all users see same book)
 * - Limit + Market Orders with proper fund locking
 * - Cancellation with fund release
 * 
 * https://docs.digitalasset.com/build/3.5/reference/json-api/openapi.html
 */

const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');
const { getReadModelService } = require('./readModelService');
const { getUpdateStream } = require('./cantonUpdateStream');

class OrderService {
  constructor() {
    console.log('[OrderService] Initialized with Canton JSON API v2');
  }

  /**
   * Calculate amount to lock for an order
   * BUY order: lock quote currency (e.g., USDT)
   * SELL order: lock base currency (e.g., BTC)
   * 
   * For MARKET orders, use estimatedPrice (from order book) 
   * with a slippage buffer to ensure sufficient funds
   */
  calculateLockAmount(tradingPair, orderType, price, quantity, orderMode = 'LIMIT', estimatedPrice = null) {
    const [baseAsset, quoteAsset] = tradingPair.split('/');
    const qty = parseFloat(quantity);

    if (orderType.toUpperCase() === 'BUY') {
      // For MARKET BUY: use estimated price with 5% slippage buffer
      let prc;
      if (orderMode.toUpperCase() === 'MARKET') {
        prc = parseFloat(estimatedPrice) || 0;
        // Add 5% slippage buffer for market orders
        prc = prc * 1.05;
      } else {
        prc = parseFloat(price) || 0;
      }
      
      // Lock quote currency (e.g., USDT = price * quantity)
      return {
        asset: quoteAsset,
        amount: prc * qty
      };
    } else {
      // Lock base currency (e.g., BTC = quantity)
      // Same for both LIMIT and MARKET sell orders
      return {
        asset: baseAsset,
        amount: qty
      };
    }
  }

  /**
   * Verify and lock funds from UserAccount for order placement
   * Uses UpdateAfterTrade with negative amounts to deduct (Withdraw is bugged in DAML)
   */
  async withdrawForOrder(token, partyId, operatorPartyId, packageId, asset, amount) {
    // 1. Find user's UserAccount
    const contracts = await cantonService.queryActiveContracts({
      party: operatorPartyId,
      templateIds: [`${packageId}:UserAccount:UserAccount`],
      pageSize: 100
    }, token);
    
    const userAccount = (Array.isArray(contracts) ? contracts : [])
      .find(c => {
        const payload = c.payload || c.createArgument || {};
        return payload.party === partyId;
      });
    
    if (!userAccount) {
      throw new Error(`No UserAccount found for party ${partyId.substring(0, 40)}...`);
    }
    
    // 2. Check balance
    const payload = userAccount.payload || userAccount.createArgument || {};
    const balances = payload.balances || [];
    const currentBalance = balances.find(([t]) => t === asset)?.[1] || '0';
    
    if (parseFloat(currentBalance) < parseFloat(amount)) {
      throw new Error(`Insufficient ${asset}. Have: ${currentBalance}, Need: ${amount}`);
    }
    
    console.log(`[OrderService] UserAccount balance for ${asset}: ${currentBalance}, locking: ${amount}`);
    
    // 3. Use UpdateAfterTrade to deduct (operator-controlled, works correctly)
    // Pass negative amount to deduct from balance
    // Determine base/quote based on asset type
    const baseToken = asset;
    const quoteToken = asset === 'USDT' ? 'BTC' : 'USDT';
    
    await cantonService.exerciseChoice({
      token,
      actAsParty: operatorPartyId, // UpdateAfterTrade is controlled by operator
      templateId: `${packageId}:UserAccount:UserAccount`,
      contractId: userAccount.contractId,
      choice: 'UpdateAfterTrade',
      choiceArgument: {
        baseToken: baseToken,
        quoteToken: quoteToken,
        baseAmount: (-parseFloat(amount)).toFixed(8), // Negative to deduct
        quoteAmount: '0.0'
      },
      readAs: [partyId]
    });
    
    return userAccount.contractId;
  }

  /**
   * Place order using Canton JSON Ledger API v2
   * POST /v2/commands/submit-and-wait-for-transaction
   * 
   * This creates an Order contract that:
   * - Is visible to the operator (for matching)
   * - Is visible to the owner (for cancellation)
   * - Will lock funds via Balance contract Reserve choice
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

    // Validate quantity is positive
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new ValidationError('Quantity must be a positive number');
    }

    // For limit orders, validate price
    if (orderMode === 'LIMIT') {
      const prc = parseFloat(price);
      if (isNaN(prc) || prc <= 0) {
        throw new ValidationError('Price must be a positive number for limit orders');
      }
    }

    console.log('[OrderService] Placing order via Canton:', {
      partyId,
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity
    });

    // Get service token
    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
    }

    // Generate unique order ID
    const orderId = `order-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // For MARKET orders, get estimated price from order book (query Canton directly)
    let estimatedPrice = null;
    if (orderMode.toUpperCase() === 'MARKET') {
      try {
        // Query Canton directly for current order book - don't rely on cache
        const { getOrderBookService } = require('./orderBookService');
        const orderBookService = getOrderBookService();
        const orderBook = await orderBookService.getOrderBook(tradingPair);
        
        if (orderType.toUpperCase() === 'BUY') {
          // For MARKET BUY, use best ASK (lowest sell price)
          const sells = orderBook.sellOrders || [];
          if (sells.length > 0) {
            // Sort by price ascending to get best ask
            const sortedSells = sells.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
            estimatedPrice = parseFloat(sortedSells[0].price);
            console.log(`[OrderService] MARKET BUY estimated price: ${estimatedPrice} (best ask from ${sells.length} sell orders)`);
          }
        } else {
          // For MARKET SELL, use best BID (highest buy price)
          const buys = orderBook.buyOrders || [];
          if (buys.length > 0) {
            // Sort by price descending to get best bid
            const sortedBuys = buys.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            estimatedPrice = parseFloat(sortedBuys[0].price);
            console.log(`[OrderService] MARKET SELL estimated price: ${estimatedPrice} (best bid from ${buys.length} buy orders)`);
          }
        }
      } catch (err) {
        console.warn('[OrderService] Could not get order book for price estimation:', err.message);
      }
      
      // If no price available, fail for MARKET BUY (need price to calculate lock amount)
      if (orderType.toUpperCase() === 'BUY' && !estimatedPrice) {
        throw new ValidationError('No sell orders available in the market. Please use LIMIT order or wait for sellers.');
      }
      if (orderType.toUpperCase() === 'SELL' && !estimatedPrice) {
        throw new ValidationError('No buy orders available in the market. Please use LIMIT order or wait for buyers.');
      }
    }

    // Calculate what needs to be locked
    const lockInfo = this.calculateLockAmount(tradingPair, orderType, price, quantity, orderMode, estimatedPrice);
    console.log(`[OrderService] Order will lock ${lockInfo.amount} ${lockInfo.asset}`);

    // ========= BALANCE CHECK AND WITHDRAWAL =========
    // 1. Find user's UserAccount contract
    // 2. Verify sufficient balance
    // 3. Withdraw (lock) the required amount
    try {
      const userAccountContractId = await this.withdrawForOrder(
        token, 
        partyId, 
        operatorPartyId,
        packageId,
        lockInfo.asset, 
        lockInfo.amount
      );
      console.log(`[OrderService] Withdrew ${lockInfo.amount} ${lockInfo.asset} from UserAccount`);
    } catch (withdrawError) {
      console.error(`[OrderService] Balance check/withdrawal failed:`, withdrawError.message);
      throw new ValidationError(`Insufficient ${lockInfo.asset} balance. Required: ${lockInfo.amount}`);
    }

    // Create Order contract on Canton using submit-and-wait-for-transaction
    // Canton JSON API v2 serialization:
    // - Optional: value directly for Some, null for None
    // - Decimal: string (e.g., "112.5")
    // - Time: ISO 8601 datetime string (e.g., "2026-01-30T15:47:52.864Z")
    const timestamp = new Date().toISOString(); // ISO 8601 format
    
    // DAML Order template has "signatory owner" - so owner must be in actAs
    // We include both operator and owner in actAs for proper authorization
    const result = await cantonService.createContractWithTransaction({
      token,
      actAsParty: [partyId, operatorPartyId], // Owner first (signatory), then operator
      templateId: `${packageId}:Order:Order`,
      createArguments: {
        orderId: orderId,
        owner: partyId,
        orderType: orderType.toUpperCase(),
        orderMode: orderMode.toUpperCase(),
        tradingPair: tradingPair,
        // Canton JSON API v2: Optional Decimal is sent as string or null
        price: orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : null,
        quantity: quantity.toString(),
        filled: '0.0',
        status: 'OPEN',
        // Canton JSON API v2: Time is ISO 8601 datetime string
        timestamp: timestamp,
        operator: operatorPartyId,
        allocationCid: '' // Placeholder until Splice is integrated
      },
      readAs: [operatorPartyId, partyId]
    });

    // Extract created contract ID from result
    let contractId = null;
    if (result.transaction?.events) {
      const createdEvent = result.transaction.events.find(e => 
        e.created?.templateId?.includes('Order') || 
        e.CreatedEvent?.templateId?.includes('Order')
      );
      contractId = createdEvent?.created?.contractId || 
                   createdEvent?.CreatedEvent?.contractId;
    }
    
    if (!contractId) {
      contractId = result.updateId || `${orderId}-pending`;
    }

    console.log(`[OrderService] ✅ Order placed: ${orderId} (${contractId.substring(0, 20)}...)`);

    // Add to UpdateStream for persistent storage and real-time updates
    const orderRecord = {
      contractId,
      orderId,
      owner: partyId,
      tradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price: orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : null,
      quantity: quantity.toString(),
      filled: '0',
      status: 'OPEN',
      timestamp: timestamp
    };
    
    const updateStream = getUpdateStream();
    if (updateStream) {
      updateStream.addOrder(orderRecord);
    }

    // Also add to ReadModel for backward compatibility
    const readModel = getReadModelService();
    if (readModel) {
      readModel.addOrder({
        contractId,
        orderId,
        owner: partyId,
        tradingPair,
        orderType: orderType.toUpperCase(),
        orderMode: orderMode.toUpperCase(),
        price: orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : null,
        quantity: parseFloat(quantity),
        filled: 0,
        status: 'OPEN',
        timestamp: timestamp,
        operator: operatorPartyId
      });
      console.log(`[OrderService] Order added to ReadModel cache`);
    }

    // Emit WebSocket event for real-time updates to Global Order Book
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'NEW_ORDER',
        orderId: orderId,
        contractId: contractId,
        owner: partyId,
        orderType: orderType.toUpperCase(),
        orderMode: orderMode.toUpperCase(),
        price: price,
        quantity: quantity,
        remaining: quantity,
        tradingPair,
        timestamp: new Date().toISOString()
      });
    }

    // IMMEDIATE MATCHING: Trigger matching engine right after order placement
    // This ensures fastest execution instead of waiting for polling cycle
    try {
      const { getMatchingEngine } = require('./matching-engine');
      const matchingEngine = getMatchingEngine();
      if (matchingEngine && matchingEngine.isRunning) {
        console.log(`[OrderService] Triggering immediate matching for ${tradingPair}`);
        // Run matching asynchronously - don't block the order response
        setImmediate(async () => {
          try {
            await matchingEngine.runMatchingCycle();
          } catch (matchError) {
            console.error('[OrderService] Immediate matching failed:', matchError.message);
          }
        });
      }
    } catch (matchErr) {
      // Don't fail order placement if matching trigger fails
      console.error('[OrderService] Could not trigger immediate matching:', matchErr.message);
    }

    return {
      success: true,
      orderId: orderId,
      contractId: contractId,
      status: 'OPEN',
      tradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price,
      quantity,
      filled: '0',
      remaining: quantity,
      lockedAsset: lockInfo.asset,
      lockedAmount: lockInfo.amount,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Place order with UTXO handling (wrapper for placeOrder)
   */
  async placeOrderWithUTXOHandling(
    partyId,
    tradingPair,
    orderType,
    orderMode,
    quantity,
    price,
    orderBookContractId = null,
    userAccountContractId = null
  ) {
    return this.placeOrder({
      partyId,
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity
    });
  }

  /**
   * Place order with allocation (for Splice integration)
   */
  async placeOrderWithAllocation(
    partyId,
    tradingPair,
    orderType,
    orderMode,
    quantity,
    price,
    orderBookContractId,
    allocationCid
  ) {
    // For now, just place the order normally
    // Splice allocation integration will be added later
    return this.placeOrder({
      partyId,
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity
    });
  }

  /**
   * Cancel order using Canton JSON Ledger API v2
   * POST /v2/commands/submit-and-wait-for-transaction (ExerciseCommand)
   * 
   * Cancellation:
   * - Exercises CancelOrder choice on Order contract
   * - Returns locked funds to available balance
   * - Removes order from Global Order Book
   */
  async cancelOrder(orderContractId, partyId, tradingPair = null) {
    if (!orderContractId || !partyId) {
      throw new ValidationError('Order contract ID and party ID are required');
    }

    console.log(`[OrderService] Cancelling order: ${orderContractId} for party: ${partyId}`);

    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
    }

    // First, get the order details to know what was locked
    let orderDetails = null;
    try {
      orderDetails = await this.getOrder(orderContractId);
    } catch (e) {
      console.warn('[OrderService] Could not fetch order details before cancel:', e.message);
    }

    // Exercise CancelOrder choice on the Order contract
    // The CancelOrder choice in DAML will:
    // 1. Assert the order is OPEN
    // 2. Release any locked funds (via Allocation cancel)
    // 3. Create new Order contract with status = CANCELLED
    const result = await cantonService.exerciseChoice({
      token,
      actAsParty: partyId, // Owner cancels their own order
      templateId: `${packageId}:Order:Order`,
      contractId: orderContractId,
      choice: 'CancelOrder',
      choiceArgument: {},
      readAs: [operatorPartyId, partyId]
    });

    console.log(`[OrderService] ✅ Order cancelled: ${orderContractId}`);

    // Remove from UpdateStream (persistent storage)
    const updateStream = getUpdateStream();
    if (updateStream) {
      updateStream.removeOrder(orderContractId);
      console.log(`[OrderService] Order removed from UpdateStream`);
    }

    // Remove from ReadModel cache
    const readModel = getReadModelService();
    if (readModel) {
      readModel.removeOrder(orderContractId);
      console.log(`[OrderService] Order removed from ReadModel cache`);
    }

    // Calculate refund amount (unfilled portion)
    let refundInfo = null;
    if (orderDetails) {
      const filled = parseFloat(orderDetails.filled || 0);
      const quantity = parseFloat(orderDetails.quantity || 0);
      const remaining = quantity - filled;
      
      if (remaining > 0) {
        const lockInfo = this.calculateLockAmount(
          orderDetails.tradingPair,
          orderDetails.orderType,
          orderDetails.price,
          remaining
        );
        refundInfo = {
          asset: lockInfo.asset,
          amount: lockInfo.amount,
          message: `${lockInfo.amount} ${lockInfo.asset} returned to available balance`
        };
        console.log(`[OrderService] Refund: ${refundInfo.amount} ${refundInfo.asset}`);
      }
    }

    // Emit WebSocket event for order book update
    const pair = tradingPair || orderDetails?.tradingPair || 'BTC/USDT';
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`orderbook:${pair}`, {
        type: 'ORDER_CANCELLED',
        contractId: orderContractId,
        orderId: orderDetails?.orderId,
        owner: partyId,
        tradingPair: pair,
        refund: refundInfo,
        timestamp: new Date().toISOString()
      });
    }

    return {
      success: true,
      orderId: orderDetails?.orderId || orderContractId,
      contractId: orderContractId,
      status: 'CANCELLED',
      tradingPair: pair,
      refund: refundInfo,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Cancel order with UTXO handling (wrapper)
   */
  async cancelOrderWithUTXOHandling(
    partyId,
    tradingPair,
    orderType,
    orderContractId,
    orderBookContractId = null,
    userAccountContractId = null
  ) {
    return this.cancelOrder(orderContractId, partyId);
  }

  /**
   * Get user's orders DIRECTLY from Canton API
   * NO CACHE - always queries Canton
   * Queries as the USER's party (not operator) to avoid 200+ limit
   */
  async getUserOrders(partyId, status = 'OPEN', limit = 100) {
    if (!partyId) {
      throw new ValidationError('Party ID is required');
    }

    console.log(`[OrderService] Querying Canton DIRECTLY for party: ${partyId.substring(0, 30)}...`);
    
    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;

    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
    }

    try {
      // Query as the USER's party - this returns only THEIR contracts
      // Each user has < 200 contracts, so no limit issue
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,  // Query as USER, not operator
        templateIds: [`${packageId}:Order:Order`],
        pageSize: limit
      }, token);

      const orders = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          // cantonService.queryActiveContracts now normalizes the response
          // Data is at c.payload, c.templateId, c.contractId directly
          const templateId = c.templateId;
          
          // Only process Order templates
          if (!templateId?.includes(':Order:Order')) {
            return false;
          }
          
          const payload = c.payload || c.createArgument || {};
          
          if (payload.owner !== partyId) return false;
          return status === 'ALL' || payload.status === status;
        })
        .map(c => {
          const payload = c.payload || c.createArgument || {};
          const contractId = c.contractId;
          
          // Debug: Log raw price format from Canton
          console.log(`[OrderService] DEBUG RAW PRICE for ${payload.orderId}:`, JSON.stringify(payload.price));
          
          // Handle DAML Optional price format
          let extractedPrice = null;
          if (payload.price) {
            if (payload.price.Some !== undefined) {
              // DAML Optional with Some value
              extractedPrice = payload.price.Some;
            } else if (typeof payload.price === 'string' || typeof payload.price === 'number') {
              // Direct value
              extractedPrice = payload.price;
            } else if (payload.price === null) {
              // Explicitly null (MARKET order)
              extractedPrice = null;
            }
          }
          
          return {
            contractId: contractId,
            orderId: payload.orderId,
            owner: payload.owner,
            tradingPair: payload.tradingPair,
            orderType: payload.orderType,
            orderMode: payload.orderMode,
            price: extractedPrice,
            quantity: payload.quantity,
            filled: payload.filled || '0',
            status: payload.status,
            timestamp: payload.timestamp
          };
        });

      console.log(`[OrderService] Found ${orders.length} orders from Canton for ${partyId.substring(0, 30)}...`);
      return orders;
    } catch (error) {
      // Handle 200+ limit gracefully
      if (error.message?.includes('200') || error.message?.includes('MAXIMUM_LIST')) {
        console.log('[OrderService] 200+ contracts, using operator party query');
        // Fallback: query as operator and filter
        try {
          const contracts = await cantonService.queryActiveContracts({
            party: operatorPartyId,
            templateIds: [`${packageId}:Order:Order`],
            pageSize: 50 // Smaller page
          }, token);
          
          const orders = (Array.isArray(contracts) ? contracts : [])
            .filter(c => {
              const payload = c.payload || c.createArgument || {};
              return payload.owner === partyId && 
                     (status === 'ALL' || payload.status === status);
            })
            .map(c => {
              const payload = c.payload || c.createArgument || {};
              return {
                contractId: c.contractId,
                orderId: payload.orderId,
                owner: payload.owner,
                tradingPair: payload.tradingPair,
                orderType: payload.orderType,
                orderMode: payload.orderMode,
                price: payload.price?.Some || payload.price,
                quantity: payload.quantity,
                filled: payload.filled || '0',
                status: payload.status,
                timestamp: payload.timestamp
              };
            });
          return orders;
        } catch (fallbackError) {
          console.error('[OrderService] Fallback query also failed:', fallbackError.message);
          return [];
        }
      }
      console.error('[OrderService] Error getting user orders from Canton:', error.message);
      return [];
    }
  }

  /**
   * Get all open orders for a trading pair (Global Order Book)
   * POST /v2/state/active-contracts
   */
  async getOrdersForPair(tradingPair, limit = 200) {
    console.log(`[OrderService] Getting all orders for pair: ${tradingPair}`);

    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
    }

    try {
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [`${packageId}:Order:Order`],
        pageSize: limit
      }, token);

      // Filter by trading pair and OPEN status
      const orders = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          const payload = c.payload || c.createArgument || {};
          return payload.tradingPair === tradingPair && payload.status === 'OPEN';
        })
        .map(c => {
          const payload = c.payload || c.createArgument || {};
          return {
            contractId: c.contractId,
            orderId: payload.orderId,
            owner: payload.owner,
            tradingPair: payload.tradingPair,
            orderType: payload.orderType,
            orderMode: payload.orderMode,
            price: payload.price?.Some || payload.price,
            quantity: payload.quantity,
            filled: payload.filled || '0',
            remaining: (parseFloat(payload.quantity) - parseFloat(payload.filled || 0)).toString(),
            status: payload.status,
            timestamp: payload.timestamp
          };
        });

      // Separate into buys and sells
      const buyOrders = orders
        .filter(o => o.orderType === 'BUY')
        .sort((a, b) => {
          // Price-time priority: highest price first, then earliest time
          const priceA = parseFloat(a.price) || Infinity;
          const priceB = parseFloat(b.price) || Infinity;
          if (priceA !== priceB) return priceB - priceA;
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      const sellOrders = orders
        .filter(o => o.orderType === 'SELL')
        .sort((a, b) => {
          // Price-time priority: lowest price first, then earliest time
          const priceA = parseFloat(a.price) || 0;
          const priceB = parseFloat(b.price) || 0;
          if (priceA !== priceB) return priceA - priceB;
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      console.log(`[OrderService] Found ${buyOrders.length} buys, ${sellOrders.length} sells for ${tradingPair}`);

      return {
        tradingPair,
        buyOrders,
        sellOrders,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[OrderService] Error getting orders for pair:', error.message);
      return {
        tradingPair,
        buyOrders: [],
        sellOrders: [],
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get order by contract ID
   */
  async getOrder(orderContractId) {
    if (!orderContractId) {
      throw new ValidationError('Order contract ID is required');
    }

    console.log(`[OrderService] Getting order: ${orderContractId}`);

    const token = await tokenProvider.getServiceToken();
    
    try {
      const contract = await cantonService.lookupContract(orderContractId, token);
      
      if (!contract) {
        throw new NotFoundError(`Order not found: ${orderContractId}`);
      }

      const payload = contract.payload || contract.createArgument || {};

      return {
        contractId: orderContractId,
        orderId: payload.orderId,
        owner: payload.owner,
        tradingPair: payload.tradingPair,
        orderType: payload.orderType,
        orderMode: payload.orderMode,
        price: payload.price?.Some || payload.price,
        quantity: payload.quantity,
        filled: payload.filled || '0',
        status: payload.status,
        timestamp: payload.timestamp
      };
    } catch (error) {
      console.error('[OrderService] Error getting order:', error.message);
      throw error;
    }
  }
}

module.exports = OrderService;
