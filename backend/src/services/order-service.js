/**
 * Order Service — Canton JSON Ledger API v2 + Canton Wallet SDK
 * 
 * Uses the correct Canton APIs:
 * - POST /v2/commands/submit-and-wait-for-transaction — Place/Cancel orders
 * - POST /v2/state/active-contracts — Query orders
 * 
 * Balance checks use the Canton Wallet SDK (listHoldingUtxos).
 * No explicit lock/unlock — holdings are locked naturally during
 * the 2-step transfer flow at settlement time.
 * 
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
const _orderReservations = new Map(); // "orderId" → { partyId, asset, amount }

function _reservationKey(partyId, asset) {
  return `${partyId}::${asset}`;
}

function getReservedBalance(partyId, asset) {
  const key = _reservationKey(partyId, asset);
  return _reservations.get(key) || new Decimal(0);
}

function addReservation(orderId, partyId, asset, amount) {
  const key = _reservationKey(partyId, asset);
  const current = _reservations.get(key) || new Decimal(0);
  _reservations.set(key, current.plus(new Decimal(amount)));
  _orderReservations.set(orderId, { partyId, asset, amount: new Decimal(amount).toString() });
  console.log(`[BalanceReservation] ➕ Reserved ${amount} ${asset} for ${orderId} (total reserved: ${_reservations.get(key).toString()})`);
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

class OrderService {
  constructor() {
    console.log('[OrderService] Initialized with Canton JSON API v2');
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
   * With the SDK approach, there is NO explicit lock/unlock.
   * Holdings are locked naturally when the 2-step transfer is created
   * at settlement time by the matching engine.
   * 
   * This method performs a soft balance check to prevent obviously
   * invalid orders from being placed.
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
   * Withdraw any pending transfer instructions for an order being cancelled.
   * 
   * With the SDK approach, there is no explicit lock/unlock.
   * If the matching engine created a TransferInstruction for this order
   * that hasn't been accepted yet, we need to withdraw it to unlock
   * the sender's holdings.
   * 
   * In practice, this is rarely needed because:
   * 1. The matching engine accepts transfers immediately after creating them
   * 2. Open orders that haven't been matched have no pending transfers
   */
  async withdrawPendingTransfersForOrder(token, partyId, orderId) {
    console.log(`[OrderService] SDK: Checking for pending transfers to withdraw for order ${orderId}`);
    
    const sdkClient = getCantonSDKClient();
    
    if (!sdkClient.isReady()) {
      console.warn('[OrderService] ⚠️ Canton SDK not ready — skipping transfer withdrawal');
      return;
    }
    
    try {
      const pendingTransfers = await sdkClient.getPendingTransfers(partyId);
      
      for (const transfer of pendingTransfers) {
        // Match transfers to this order via the memo/reason field
        // The matching engine sets memo = "settlement:<buyOrderId>:<sellOrderId>:<type>"
        const memo = transfer.meta?.values?.['splice.lfdecentralizedtrust.org/reason'] || '';
        if (memo.includes(orderId)) {
          try {
            await sdkClient.withdrawTransfer(transfer.contractId, partyId);
            console.log(`[OrderService] ✅ Withdrew pending transfer: ${transfer.contractId.substring(0, 30)}...`);
          } catch (withdrawErr) {
            console.warn(`[OrderService] ⚠️ Could not withdraw transfer: ${withdrawErr.message}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[OrderService] ⚠️ Failed to check pending transfers: ${err.message}`);
      // Don't throw — order cancellation should still proceed
    }
  }

  /**
   * Place order using Canton JSON Ledger API v2.
   * Checks balance via Canton SDK, then creates an Order contract on Canton.
   * No explicit lock — holdings are locked at settlement time by the 2-step transfer.
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

    // ========= CHECK BALANCE VIA CANTON SDK =========
    // With the SDK approach, there is NO explicit lock at order placement.
    // Holdings are locked naturally when the 2-step transfer is created
    // at settlement time by the matching engine (createTransfer → accept).
    // We only do a soft balance check here to reject obviously invalid orders.
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

    // ═══ RESERVE BALANCE to prevent overselling ═══
    // Track this order's required funds so subsequent orders see reduced available balance.
    // Released on cancel, or partially released as the order fills during settlement.
    addReservation(orderId, partyId, lockInfo.asset, lockInfo.amount);

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
        // No explicit lock — SDK handles locking at 2-step transfer time
        allocationCid: ''
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
      timestamp: timestamp,
      // No explicit lock — SDK locks UTXOs at transfer time
      lockId: null,
      lockedAmount: lockInfo.amount,
      lockedAsset: lockInfo.asset
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

    // ═══ IMMEDIATE MATCHING: Trigger matching engine for this specific pair ═══
    // Previously: Gated by matchingEngine.isRunning (broken on serverless),
    //   used setImmediate (fire-and-forget, unreliable), called runMatchingCycle()
    //   which processes ALL pairs (slow) and competes with polling loop.
    // Now: Always triggers, targets ONLY this pair, queues if busy.
    try {
      const { getMatchingEngine } = require('./matching-engine');
      const matchingEngine = getMatchingEngine();
      if (matchingEngine) {
        console.log(`[OrderService] Triggering immediate matching for ${tradingPair}`);
        // Use triggerMatchingCycle which targets a specific pair and queues if busy
        const triggerResult = await matchingEngine.triggerMatchingCycle(tradingPair);
        if (triggerResult.success) {
          console.log(`[OrderService] ✅ Matching cycle completed for ${tradingPair} in ${triggerResult.elapsed}ms`);
        } else {
          console.log(`[OrderService] ⏳ Matching trigger result: ${triggerResult.reason}`);
        }
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
      lockId: null, // No explicit lock — SDK handles locking at transfer time
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
   * Cancel order: withdraws any pending transfer instructions via Canton SDK,
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
    // Use queryActiveContracts (more reliable than lookupContract which needs readers)
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

    // Withdraw any pending transfer instructions for this order (SDK approach)
    // With the SDK, there's no explicit lock/unlock. Instead, if the matching engine
    // created a TransferInstruction for this order that hasn't been accepted yet,
    // we withdraw it to release the sender's locked holdings.
    const orderId_cancel = orderDetails?.orderId;
    if (orderId_cancel) {
      try {
        await this.withdrawPendingTransfersForOrder(token, partyId, orderId_cancel);
        console.log(`[OrderService] ✅ Pending transfers checked/withdrawn for cancelled order`);
      } catch (withdrawErr) {
        console.warn('[OrderService] Could not withdraw pending transfers:', withdrawErr.message);
        // Continue with cancellation even if withdrawal fails
      }
    } else {
      console.log(`[OrderService] No orderId for pending transfer check — skipping`);
    }

    // Exercise CancelOrder choice on the Order contract
    // The CancelOrder choice in DAML will:
    // 1. Assert the order is OPEN
    // 2. Release any locked funds (via Allocation cancel)
    // 3. Create new Order contract with status = CANCELLED
    // Try with new package first, fallback to legacy if contract was created with old package
    let result;
    try {
      result = await cantonService.exerciseChoice({
      token,
      actAsParty: partyId, // Owner cancels their own order
      templateId: `${packageId}:Order:Order`,
      contractId: orderContractId,
      choice: 'CancelOrder',
      choiceArgument: {},
      readAs: [operatorPartyId, partyId]
    });
    } catch (cancelErr) {
      // If new package fails, try legacy package
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
      // Query BOTH new and legacy packages to show all user orders
      const legacyPackageId = config.canton.packageIds?.legacy;
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      if (legacyPackageId && legacyPackageId !== packageId) {
        templateIdsToQuery.push(`${legacyPackageId}:Order:Order`);
      }
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,  // Query as USER, not operator
        templateIds: templateIdsToQuery,
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
            timestamp: payload.timestamp,
            allocationCid: payload.allocationCid || null
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
