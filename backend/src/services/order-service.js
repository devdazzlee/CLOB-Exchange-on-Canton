/**
 * Order Service — Canton JSON Ledger API v2 + Allocation-Based Settlement
 * 
 * Uses the correct Canton APIs:
 * - POST /v2/commands/submit-and-wait-for-transaction — Place/Cancel orders
 * - POST /v2/state/active-contracts — Query orders
 * 
 * Balance checks use the Canton Wallet SDK (listHoldingUtxos).
 * 
 * Settlement is Allocation-based:
 * - At ORDER PLACEMENT: creates an Allocation (exchange = executor, funds locked)
 * - At MATCH TIME: exchange executes Allocation with its OWN key (no user key needed)
 * - At CANCEL: Allocation_Cancel releases locked funds back to sender
 * 
 * Why Allocations (not TransferInstruction):
 * - TransferInstruction requires user's private key at SETTLEMENT time
 * - With external parties, backend has no user keys → TransferInstruction breaks
 * - Allocation: User signs ONCE at order time, exchange settles with its own key
 * 
 * @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-v1/
 * @see https://docs.digitalasset.com/integrate/devnet/token-standard/index.html
 */

const Decimal = require('decimal.js');
const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');
const { getReadModelService } = require('./readModelService');
const { getUpdateStream } = require('./cantonUpdateStream');
const { getCantonSDKClient } = require('./canton-sdk-client');

// Configure Decimal for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE RESERVATION TRACKER
// Prevents overselling by tracking how much balance is "spoken for" by
// open orders that haven't settled yet. The Canton SDK's soft balance check
// only sees the on-chain available balance — it doesn't know about pending
// orders in the order book that will require those funds at settlement time.
//
// Key: "partyId::asset" → total reserved amount (Decimal)
// Updated on: order placement (+), cancellation (-), settlement fill (-)
// ═══════════════════════════════════════════════════════════════════════════
const _reservations = new Map();    // "partyId::asset" → Decimal amount
const _orderReservations = new Map(); // "orderId" → { partyId, asset, amount, allocationContractId }

function _reservationKey(partyId, asset) {
  return `${partyId}::${asset}`;
}

function getReservedBalance(partyId, asset) {
  const key = _reservationKey(partyId, asset);
  return _reservations.get(key) || new Decimal(0);
}

function addReservation(orderId, partyId, asset, amount, allocationContractId = null) {
  const key = _reservationKey(partyId, asset);
  const current = _reservations.get(key) || new Decimal(0);
  _reservations.set(key, current.plus(new Decimal(amount)));
  _orderReservations.set(orderId, {
    partyId,
    asset,
    amount: new Decimal(amount).toString(),
    allocationContractId,
  });
  console.log(`[BalanceReservation] ➕ Reserved ${amount} ${asset} for ${orderId} (total reserved: ${_reservations.get(key).toString()}, allocation: ${allocationContractId ? allocationContractId.substring(0, 30) + '...' : 'none'})`);
}

function releaseReservation(orderId) {
  const reservation = _orderReservations.get(orderId);
  if (!reservation) return;

  const key = _reservationKey(reservation.partyId, reservation.asset);
  const current = _reservations.get(key) || new Decimal(0);
  const newAmount = Decimal.max(current.minus(new Decimal(reservation.amount)), new Decimal(0));
  _reservations.set(key, newAmount);
  _orderReservations.delete(orderId);
  console.log(`[BalanceReservation] ➖ Released ${reservation.amount} ${reservation.asset} for ${orderId} (total reserved: ${newAmount.toString()})`);
}

function releasePartialReservation(orderId, filledAmount) {
  const reservation = _orderReservations.get(orderId);
  if (!reservation) return;

  const key = _reservationKey(reservation.partyId, reservation.asset);
  const current = _reservations.get(key) || new Decimal(0);
  const releaseAmt = Decimal.min(new Decimal(filledAmount), new Decimal(reservation.amount));
  const newReserved = Decimal.max(current.minus(releaseAmt), new Decimal(0));
  _reservations.set(key, newReserved);

  // Update the order's remaining reservation
  const remaining = Decimal.max(new Decimal(reservation.amount).minus(releaseAmt), new Decimal(0));
  if (remaining.lte(0)) {
    _orderReservations.delete(orderId);
  } else {
    reservation.amount = remaining.toString();
  }
  console.log(`[BalanceReservation] ➖ Partially released ${filledAmount} ${reservation.asset} for ${orderId} (remaining reservation: ${remaining.toString()})`);
}

/**
 * Get the allocation contract ID stored for an order's reservation.
 */
function getAllocationContractIdForOrder(orderId) {
  const reservation = _orderReservations.get(orderId);
  return reservation?.allocationContractId || null;
}

class OrderService {
  constructor() {
    console.log('[OrderService] Initialized with Canton JSON API v2 + Allocation-based settlement');
  }

  /**
   * Calculate amount to lock for an order (uses Decimal for precision).
   * BUY order: lock quote currency (e.g., CBTC for CC/CBTC pair)
   * SELL order: lock base currency (e.g., CC for CC/CBTC pair)
   * 
   * For MARKET orders, use estimatedPrice (from order book) 
   * with a 5% slippage buffer to ensure sufficient funds.
   */
  calculateLockAmount(tradingPair, orderType, price, quantity, orderMode = 'LIMIT', estimatedPrice = null) {
    const [baseAsset, quoteAsset] = tradingPair.split('/');
    const qty = new Decimal(quantity);

    if (orderType.toUpperCase() === 'BUY') {
      let prc;
      if (orderMode.toUpperCase() === 'MARKET') {
        prc = new Decimal(estimatedPrice || '0').times('1.05'); // 5% slippage buffer
      } else {
        prc = new Decimal(price || '0');
      }
      
      return {
        asset: quoteAsset,
        amount: prc.times(qty).toNumber()
      };
    } else {
      return {
        asset: baseAsset,
        amount: qty.toNumber()
      };
    }
  }

  /**
   * Check available balance via Canton Wallet SDK before order placement.
   * 
   * @returns {Object} { verified: true, availableBalance, asset }
   */
  async checkBalanceForOrder(token, partyId, operatorPartyId, asset, amount, orderId) {
    console.log(`[OrderService] SDK: Checking ${amount} ${asset} balance for order ${orderId}`);
    
    const sdkClient = getCantonSDKClient();
    
    if (!sdkClient.isReady()) {
      console.warn(`[OrderService] ⚠️ Canton SDK not ready — skipping balance check (order will proceed)`);
      return { verified: false, availableBalance: 0, asset };
    }

    try {
      const balance = await sdkClient.getBalance(partyId, asset);
      const availableBalance = parseFloat(balance.available || '0');

      // Deduct balance already reserved by other open orders (prevents overselling)
      const reserved = getReservedBalance(partyId, asset);
      const effectiveAvailable = new Decimal(availableBalance).minus(reserved);
      
      if (effectiveAvailable.lt(new Decimal(amount))) {
        throw new ValidationError(
          `Insufficient ${asset} balance. On-chain available: ${availableBalance}, ` +
          `Reserved by open orders: ${reserved.toString()}, ` +
          `Effective available: ${effectiveAvailable.toString()}, ` +
          `Required: ${amount}`
        );
      }
      console.log(`[OrderService] ✅ Balance check passed: ${availableBalance} ${asset} on-chain, ${reserved.toString()} reserved, ${effectiveAvailable.toString()} effective (need ${amount})`);
      
      return {
        verified: true,
        availableBalance: effectiveAvailable.toNumber(),
        asset,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      console.warn(`[OrderService] ⚠️ Balance check failed (proceeding anyway): ${err.message}`);
      return { verified: false, availableBalance: 0, asset };
    }
  }

  /**
   * Cancel the Allocation associated with an order being cancelled.
   * 
   * With Allocation-based settlement, each order has an Allocation contract
   * that locks the user's holdings. Cancelling the Allocation releases
   * the locked funds back to the user.
   * 
   * @param {string} orderId - Order ID (for looking up the allocation)
   * @param {string} allocationContractId - The Allocation contract ID (from order creation)
   * @param {string} partyId - The order owner (sender in the allocation)
   */
  async cancelAllocationForOrder(orderId, allocationContractId, partyId) {
    console.log(`[OrderService] 🔓 Cancelling Allocation for order ${orderId}`);

    const sdkClient = getCantonSDKClient();
    
    if (!sdkClient.isReady()) {
      console.warn('[OrderService] ⚠️ Canton SDK not ready — skipping Allocation cancellation');
      return;
    }

    // Find the allocationContractId from the reservation if not provided
    if (!allocationContractId) {
      allocationContractId = getAllocationContractIdForOrder(orderId);
    }

    if (!allocationContractId) {
      console.log(`[OrderService] No allocationContractId for order ${orderId} — nothing to cancel`);
      return;
    }

    const executorPartyId = config.canton.operatorPartyId;

    try {
      await sdkClient.cancelAllocation(allocationContractId, partyId, executorPartyId);
      console.log(`[OrderService] ✅ Allocation cancelled for order ${orderId} — funds released`);
    } catch (cancelErr) {
      console.warn(`[OrderService] ⚠️ Could not cancel Allocation: ${cancelErr.message}`);
      // Don't throw — order cancellation should still proceed
    }
  }

  /**
   * Place order using Canton JSON Ledger API v2.
   * 
   * Flow:
   * 1. Check balance via Canton SDK
   * 2. Create Allocation (exchange = executor, funds locked)
   * 3. Create Order contract on Canton
   * 4. Trigger matching engine
   * 
   * The Allocation ensures funds are locked at order time.
   * The exchange can settle at match time with its own key.
   */
  async placeOrder(orderData) {
    const {
      partyId,
      tradingPair,
      orderType, // BUY | SELL
      orderMode, // LIMIT | MARKET | STOP_LOSS
      price,
      quantity,
      timeInForce = 'GTC',
      stopPrice = null, // For STOP_LOSS orders
    } = orderData;

    // Validation
    if (!partyId || !tradingPair || !orderType || !orderMode || !quantity) {
      throw new ValidationError('Missing required fields: partyId, tradingPair, orderType, orderMode, quantity');
    }

    // Validate standard order types
    if (orderMode === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    // Validate stop-loss orders
    if (orderMode === 'STOP_LOSS') {
      if (!stopPrice) {
        throw new ValidationError('stopPrice is required for STOP_LOSS orders');
      }
      const sp = parseFloat(stopPrice);
      if (isNaN(sp) || sp <= 0) {
        throw new ValidationError('stopPrice must be a positive number');
      }

      // Validate stop-loss price direction
      try {
        const { getOrderBookService } = require('./orderBookService');
        const orderBookService = getOrderBookService();
        const orderBook = await orderBookService.getOrderBook(tradingPair);
        
        // Get current market price for validation
        const buys = orderBook.buyOrders || [];
        const sells = orderBook.sellOrders || [];
        let currentPrice = null;
        
        if (buys.length > 0 && sells.length > 0) {
          const bestBid = parseFloat(buys.sort((a, b) => parseFloat(b.price) - parseFloat(a.price))[0].price);
          const bestAsk = parseFloat(sells.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0].price);
          currentPrice = (bestBid + bestAsk) / 2;
        } else if (buys.length > 0) {
          currentPrice = parseFloat(buys[0].price);
        } else if (sells.length > 0) {
          currentPrice = parseFloat(sells[0].price);
        }

        if (currentPrice) {
          // SELL stop loss must be below current price
          if (orderType.toUpperCase() === 'SELL' && new Decimal(stopPrice).gte(new Decimal(currentPrice))) {
            throw new ValidationError(
              `SELL stop loss stopPrice (${stopPrice}) must be below current market price (${currentPrice.toFixed(4)})`
            );
          }
          // BUY stop loss must be above current price
          if (orderType.toUpperCase() === 'BUY' && new Decimal(stopPrice).lte(new Decimal(currentPrice))) {
            throw new ValidationError(
              `BUY stop loss stopPrice (${stopPrice}) must be above current market price (${currentPrice.toFixed(4)})`
            );
          }
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        console.warn('[OrderService] Could not validate stop price against market:', err.message);
        // Continue — validation is best-effort
      }
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
      quantity,
      stopPrice: stopPrice || 'N/A',
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
        const { getOrderBookService } = require('./orderBookService');
        const orderBookService = getOrderBookService();
        const orderBook = await orderBookService.getOrderBook(tradingPair);
        
        if (orderType.toUpperCase() === 'BUY') {
          const sells = orderBook.sellOrders || [];
          if (sells.length > 0) {
            const sortedSells = sells.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
            estimatedPrice = parseFloat(sortedSells[0].price);
            console.log(`[OrderService] MARKET BUY estimated price: ${estimatedPrice} (best ask from ${sells.length} sell orders)`);
          }
        } else {
          const buys = orderBook.buyOrders || [];
          if (buys.length > 0) {
            const sortedBuys = buys.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            estimatedPrice = parseFloat(sortedBuys[0].price);
            console.log(`[OrderService] MARKET SELL estimated price: ${estimatedPrice} (best bid from ${buys.length} buy orders)`);
          }
        }
      } catch (err) {
        console.warn('[OrderService] Could not get order book for price estimation:', err.message);
      }
      
      if (orderType.toUpperCase() === 'BUY' && !estimatedPrice) {
        throw new ValidationError('No sell orders available in the market. Please use LIMIT order or wait for sellers.');
      }
      if (orderType.toUpperCase() === 'SELL' && !estimatedPrice) {
        throw new ValidationError('No buy orders available in the market. Please use LIMIT order or wait for buyers.');
      }
    }

    // For STOP_LOSS orders, use stopPrice for lock amount calculation
    // (funds must be locked NOW, even though the order triggers later)
    let effectivePrice = price;
    let effectiveOrderMode = orderMode;
    if (orderMode === 'STOP_LOSS') {
      // Use stop price for balance calculation
      effectivePrice = stopPrice;
      effectiveOrderMode = 'LIMIT'; // Lock based on stop price
    }

    // Calculate what needs to be locked
    const lockInfo = this.calculateLockAmount(tradingPair, orderType, effectivePrice, quantity, effectiveOrderMode, estimatedPrice);
    console.log(`[OrderService] Order will lock ${lockInfo.amount} ${lockInfo.asset}`);

    // ========= CHECK BALANCE VIA CANTON SDK =========
    let balanceCheck = null;
    try {
      balanceCheck = await this.checkBalanceForOrder(
        token, 
        partyId, 
        operatorPartyId,
        lockInfo.asset, 
        lockInfo.amount,
        orderId
      );
      if (balanceCheck.verified) {
        console.log(`[OrderService] ✅ Balance verified: ${balanceCheck.availableBalance} ${lockInfo.asset} available`);
      } else {
        console.warn(`[OrderService] ⚠️ Balance check skipped (SDK not ready) — order will proceed`);
      }
    } catch (balanceError) {
      console.error(`[OrderService] Balance check failed:`, balanceError.message);
      throw new ValidationError(`Insufficient ${lockInfo.asset} balance. Required: ${lockInfo.amount}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP A: Create Allocation — locks funds, exchange = executor
    // User signs ONCE here (for external parties, their key is used)
    // Exchange settles later with its own key (no user key needed)
    // ═══════════════════════════════════════════════════════════════════
    let allocationContractId = null;
    const sdkClient = getCantonSDKClient();

    if (sdkClient.isReady()) {
      try {
        console.log(`[OrderService] 📋 Creating Allocation for order ${orderId}...`);
        const allocationResult = await sdkClient.createAllocation(
          partyId,           // sender — the order placer (funds locked)
          null,              // receiver — unknown at order time (set at match)
          lockInfo.amount.toString(),
          lockInfo.asset,    // instrument symbol
          operatorPartyId,   // executor — the exchange (settles at match time)
          orderId
        );
        allocationContractId = allocationResult.allocationContractId;
        console.log(`[OrderService] ✅ Allocation created: ${allocationContractId?.substring(0, 30) || 'N/A'}... (funds locked in Allocation)`);
      } catch (allocErr) {
        console.warn(`[OrderService] ⚠️ Allocation creation failed: ${allocErr.message}`);
        console.warn(`[OrderService] ⚠️ Proceeding without Allocation — SDK balance reservation in effect`);
        // Don't fail the order — soft balance reservation still prevents overselling
      }
    } else {
      console.warn(`[OrderService] ⚠️ Canton SDK not ready — proceeding without Allocation`);
    }

    // ═══ RESERVE BALANCE to prevent overselling ═══
    addReservation(orderId, partyId, lockInfo.asset, lockInfo.amount, allocationContractId);

    // Determine initial order status
    // STOP_LOSS orders start as 'PENDING_TRIGGER' — NOT added to active order book
    const initialStatus = orderMode === 'STOP_LOSS' ? 'PENDING_TRIGGER' : 'OPEN';

    // Create Order contract on Canton using submit-and-wait-for-transaction
    const timestamp = new Date().toISOString();
    
    const result = await cantonService.createContractWithTransaction({
      token,
      actAsParty: [partyId, operatorPartyId],
      templateId: `${packageId}:Order:Order`,
      createArguments: {
        orderId: orderId,
        owner: partyId,
        orderType: orderType.toUpperCase(),
        orderMode: orderMode.toUpperCase(),
        tradingPair: tradingPair,
        price: orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : (stopPrice ? stopPrice.toString() : null),
        quantity: quantity.toString(),
        filled: '0.0',
        status: initialStatus,
        timestamp: timestamp,
        operator: operatorPartyId,
        allocationCid: allocationContractId || '',
        stopPrice: stopPrice ? stopPrice.toString() : null
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

    console.log(`[OrderService] ✅ Order placed: ${orderId} (${contractId.substring(0, 20)}...) [status: ${initialStatus}]`);

    // Add to UpdateStream for persistent storage and real-time updates
    const orderRecord = {
      contractId,
      orderId,
      owner: partyId,
      tradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price: orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : null,
      stopPrice: stopPrice ? stopPrice.toString() : null,
      quantity: quantity.toString(),
      filled: '0',
      status: initialStatus,
      timestamp: timestamp,
      lockId: null,
      lockedAmount: lockInfo.amount,
      lockedAsset: lockInfo.asset,
      allocationContractId: allocationContractId || null,
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
        stopPrice: stopPrice ? stopPrice.toString() : null,
        quantity: parseFloat(quantity),
        filled: 0,
        status: initialStatus,
        timestamp: timestamp,
        operator: operatorPartyId,
        allocationContractId: allocationContractId || null,
      });
      console.log(`[OrderService] Order added to ReadModel cache`);
    }

    // Emit WebSocket event for real-time updates to Global Order Book
    // STOP_LOSS orders are NOT broadcast to the order book (invisible until triggered)
    if (global.broadcastWebSocket && initialStatus === 'OPEN') {
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

    // Register stop-loss with the StopLossService if applicable
    if (orderMode === 'STOP_LOSS') {
      try {
        const { getStopLossService } = require('./stopLossService');
        const stopLossService = getStopLossService();
        stopLossService.registerStopLoss({
          orderContractId: contractId,
          orderId,
          tradingPair,
          orderType: orderType.toUpperCase(),
          stopPrice: stopPrice,
          partyId,
          quantity: quantity.toString(),
          allocationContractId: allocationContractId || null,
        });
        console.log(`[OrderService] ✅ Stop-loss registered: triggers at ${stopPrice}`);
      } catch (slErr) {
        console.warn(`[OrderService] ⚠️ Failed to register stop-loss: ${slErr.message}`);
      }
    }

    // ═══ IMMEDIATE MATCHING: Trigger matching engine (only for OPEN orders) ═══
    if (initialStatus === 'OPEN') {
      try {
        const { getMatchingEngine } = require('./matching-engine');
        const matchingEngine = getMatchingEngine();
        if (matchingEngine) {
          console.log(`[OrderService] Triggering immediate matching for ${tradingPair}`);
          const triggerResult = await matchingEngine.triggerMatchingCycle(tradingPair);
          if (triggerResult.success) {
            console.log(`[OrderService] ✅ Matching cycle completed for ${tradingPair} in ${triggerResult.elapsed}ms`);
          } else {
            console.log(`[OrderService] ⏳ Matching trigger result: ${triggerResult.reason}`);
          }
        }
      } catch (matchErr) {
        console.error('[OrderService] Could not trigger immediate matching:', matchErr.message);
      }
    }

    return {
      success: true,
      orderId: orderId,
      contractId: contractId,
      status: initialStatus,
      tradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price,
      stopPrice: stopPrice || null,
      quantity,
      filled: '0',
      remaining: quantity,
      lockedAsset: lockInfo.asset,
      lockedAmount: lockInfo.amount,
      allocationContractId: allocationContractId || null,
      tokenStandard: true,
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
   * Place order with allocation (now default behavior)
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
   * Cancel order: cancels the Allocation (releases locked funds),
   * then exercises CancelOrder on Canton to archive the Order contract.
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
      const legacyPackageId = config.canton.packageIds?.legacy;
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      if (legacyPackageId && legacyPackageId !== packageId) {
        templateIdsToQuery.push(`${legacyPackageId}:Order:Order`);
      }
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: templateIdsToQuery,
        pageSize: 200
      }, token);
      
      const matchingContract = (Array.isArray(contracts) ? contracts : [])
        .find(c => c.contractId === orderContractId);
      
      if (matchingContract) {
        const payload = matchingContract.payload || matchingContract.createArgument || {};
        orderDetails = {
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
          timestamp: payload.timestamp,
          allocationCid: payload.allocationCid || null
        };
        console.log(`[OrderService] Found order details: ${orderDetails.orderId}, allocationCid: ${orderDetails.allocationCid?.substring(0, 30) || 'none'}...`);
      } else {
        console.warn(`[OrderService] Order ${orderContractId.substring(0, 30)}... not found in active contracts`);
      }
    } catch (e) {
      console.warn('[OrderService] Could not fetch order details before cancel:', e.message);
    }

    // ═══ Cancel the Allocation — release locked funds via Allocation_Cancel ═══
    const orderId_cancel = orderDetails?.orderId;
    if (orderId_cancel) {
      const allocationCid = orderDetails?.allocationCid || getAllocationContractIdForOrder(orderId_cancel);
      if (allocationCid) {
        try {
          await this.cancelAllocationForOrder(orderId_cancel, allocationCid, partyId);
          console.log(`[OrderService] ✅ Allocation cancelled — funds released`);
        } catch (allocCancelErr) {
          console.warn('[OrderService] Could not cancel Allocation:', allocCancelErr.message);
          // Continue with cancellation even if allocation cancel fails
        }
      } else {
        console.log(`[OrderService] No allocationCid for order — skipping Allocation cancel`);
      }
    }

    // Unregister stop-loss if this was a stop-loss order
    if (orderDetails?.orderMode === 'STOP_LOSS' || orderDetails?.status === 'PENDING_TRIGGER') {
      try {
        const { getStopLossService } = require('./stopLossService');
        const stopLossService = getStopLossService();
        stopLossService.unregisterStopLoss(orderContractId);
        console.log(`[OrderService] ✅ Stop-loss unregistered for cancelled order`);
      } catch (slErr) {
        console.warn(`[OrderService] ⚠️ Could not unregister stop-loss: ${slErr.message}`);
      }
    }

    // Exercise CancelOrder choice on the Order contract
    let result;
    try {
      result = await cantonService.exerciseChoice({
        token,
        actAsParty: partyId,
        templateId: `${packageId}:Order:Order`,
        contractId: orderContractId,
        choice: 'CancelOrder',
        choiceArgument: {},
        readAs: [operatorPartyId, partyId]
      });
    } catch (cancelErr) {
      const legacyPackageId = config.canton.packageIds?.legacy;
      if (legacyPackageId && legacyPackageId !== packageId) {
        console.log(`[OrderService] Retrying cancel with legacy package...`);
        result = await cantonService.exerciseChoice({
          token,
          actAsParty: partyId,
          templateId: `${legacyPackageId}:Order:Order`,
          contractId: orderContractId,
          choice: 'CancelOrder',
          choiceArgument: {},
          readAs: [operatorPartyId, partyId]
        });
      } else {
        throw cancelErr;
      }
    }

    console.log(`[OrderService] ✅ Order cancelled: ${orderContractId}`);

    // Release balance reservation so other orders can use the freed funds
    if (orderId_cancel) {
      releaseReservation(orderId_cancel);
    }

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
          message: `${lockInfo.amount} ${lockInfo.asset} returned to available balance (Allocation cancelled)`
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
      const legacyPackageId = config.canton.packageIds?.legacy;
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      if (legacyPackageId && legacyPackageId !== packageId) {
        templateIdsToQuery.push(`${legacyPackageId}:Order:Order`);
      }
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: templateIdsToQuery,
        pageSize: limit
      }, token);

      const orders = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          const templateId = c.templateId;
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
          
          console.log(`[OrderService] DEBUG RAW PRICE for ${payload.orderId}:`, JSON.stringify(payload.price));
          
          let extractedPrice = null;
          if (payload.price) {
            if (payload.price.Some !== undefined) {
              extractedPrice = payload.price.Some;
            } else if (typeof payload.price === 'string' || typeof payload.price === 'number') {
              extractedPrice = payload.price;
            } else if (payload.price === null) {
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
            timestamp: payload.timestamp,
            allocationCid: payload.allocationCid || null
          };
        });

      console.log(`[OrderService] Found ${orders.length} orders from Canton for ${partyId.substring(0, 30)}...`);
      return orders;
    } catch (error) {
      if (error.message?.includes('200') || error.message?.includes('MAXIMUM_LIST')) {
        console.log('[OrderService] 200+ contracts, using operator party query');
        try {
          const operatorPartyId = config.canton.operatorPartyId;
          const contracts = await cantonService.queryActiveContracts({
            party: operatorPartyId,
            templateIds: [`${packageId}:Order:Order`],
            pageSize: 50
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

      // Filter by trading pair and OPEN status (exclude PENDING_TRIGGER stop-loss orders)
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
            timestamp: payload.timestamp,
            allocationCid: payload.allocationCid || null,
          };
        });

      const buyOrders = orders
        .filter(o => o.orderType === 'BUY')
        .sort((a, b) => {
          const priceA = parseFloat(a.price) || Infinity;
          const priceB = parseFloat(b.price) || Infinity;
          if (priceA !== priceB) return priceB - priceA;
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      const sellOrders = orders
        .filter(o => o.orderType === 'SELL')
        .sort((a, b) => {
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
        timestamp: payload.timestamp,
        allocationCid: payload.allocationCid || null
      };
    } catch (error) {
      console.error('[OrderService] Error getting order:', error.message);
      throw error;
    }
  }
}

module.exports = OrderService;

// Export reservation helpers for use by the matching engine
module.exports.releaseReservation = releaseReservation;
module.exports.releasePartialReservation = releasePartialReservation;
module.exports.getReservedBalance = getReservedBalance;
module.exports.getAllocationContractIdForOrder = getAllocationContractIdForOrder;
