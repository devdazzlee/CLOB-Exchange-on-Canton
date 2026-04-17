/**
 * Order Service — Canton JSON Ledger API v2 + Allocation-Based Settlement
 *
 * Client signing model (non-custodial):
 * - Order placement (interactive prepare/execute): only the end-user's `partyId` appears in
 *   `partySignatures`; hashes are signed in the browser. Private keys never leave the client.
 *   OAuth bearer tokens on the backend authorize JSON Ledger API calls only, not user keys.
 * - Order settlement / match (submit-and-wait): `actAs` is the app provider (operator) party
 *   only — hosted participant keys; users are not signers on settlement transactions.
 *
 * Uses:
 * - POST /v2/interactive-submission/prepare|execute — external user signs placement/cancel
 * - POST /v2/commands/submit-and-wait-for-transaction — provider-settled matches, cancels server-side where applicable
 * - POST /v2/state/active-contracts — Query orders
 *
 * Balance checks use the Canton Wallet SDK (listHoldingUtxos).
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
const { getCantonSDKClient } = require('./canton-sdk-client');

// Configure Decimal for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE RESERVATION TRACKER — PostgreSQL via Prisma (Neon)
// ALL reads/writes go directly to PostgreSQL. No in-memory cache.
// ═══════════════════════════════════════════════════════════════════════════
const { getDb } = require('./db');

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL OPEN ORDER REGISTRY (in-memory — rebuilt from Canton on each query)
// This is OK: it's a Canton data cache, not application state.
// ═══════════════════════════════════════════════════════════════════════════
const _globalOpenOrders = new Map();

function registerOpenOrders(orders) {
  if (!Array.isArray(orders)) return;
  const { getMatchingEngine } = require('./matching-engine');
  const engine = getMatchingEngine();
  
  const db = getDb();

  for (const order of orders) {
    if (order.status === 'OPEN' && order.contractId && !engine.invalidSettlementContracts.has(order.contractId)) {
      _globalOpenOrders.set(order.contractId, {
        contractId: order.contractId,
        orderId: order.orderId,
        owner: order.owner,
        tradingPair: order.tradingPair,
        orderType: order.orderType,
        orderMode: order.orderMode,
        price: order.price,
        quantity: order.quantity,
        filled: order.filled || '0',
        remaining: parseFloat(order.quantity || 0) - parseFloat(order.filled || 0),
        status: 'OPEN',
        timestamp: order.timestamp,
        allocationContractId: order.allocationContractId || null,
      });

      // Persist to DB asynchronously
      db.order.upsert({
        where: { orderId: order.orderId },
        update: {
          id: order.contractId,
          filled: order.filled || '0',
          status: 'OPEN',
          allocationContractId: order.allocationContractId || null
        },
        create: {
          id: order.contractId,
          orderId: order.orderId,
          owner: order.owner,
          tradingPair: order.tradingPair,
          orderType: order.orderType,
          orderMode: order.orderMode,
          price: order.price,
          quantity: order.quantity,
          filled: order.filled || '0',
          status: 'OPEN',
          allocationContractId: order.allocationContractId || null
        }
      }).catch(err => console.error('[OrderService/DB] Failed to upsert OPEN order:', err.message));
    }
  }
  for (const order of orders) {
    if (order.status !== 'OPEN' && order.contractId && _globalOpenOrders.has(order.contractId)) {
      _globalOpenOrders.delete(order.contractId);
      
      // Update DB status asynchronously
      db.order.updateMany({
        where: { id: order.contractId },
        data: { status: order.status, filled: order.filled || '0' }
      }).catch(err => console.error('[OrderService/DB] Failed to update CLOSED order:', err.message));
    }
  }
}

function getGlobalOpenOrders() {
  return [..._globalOpenOrders.values()];
}

async function getReservedBalance(partyId, asset) {
  const db = getDb();
  // OrderReservation.amount is String (Decimal). Prisma aggregate _sum does not support String.
  // Use findMany + manual sum.
  const rows = await db.orderReservation.findMany({
    where: { partyId, asset },
    select: { amount: true },
  });
  let total = new Decimal(0);
  for (const r of rows) {
    total = total.plus(new Decimal(r.amount || '0'));
  }
  return total;
}

async function addReservation(orderId, partyId, asset, amount, allocationContractId = null, allocationType = 'EXCHANGE') {
  const db = getDb();
  const amountStr = new Decimal(amount).toString();
  await db.orderReservation.upsert({
    where: { orderId },
    create: { orderId, partyId, asset, amount: amountStr, allocationContractId, allocationType },
    update: { partyId, asset, amount: amountStr, allocationContractId, allocationType },
  });
  console.log(`[BalanceReservation] ➕ Reserved ${amount} ${asset} for ${orderId} (allocation: ${allocationContractId ? allocationContractId.substring(0, 30) + '...' : 'none'}, type: ${allocationType})`);
}

async function releaseReservation(orderId) {
  const db = getDb();
  try {
    const reservation = await db.orderReservation.findUnique({ where: { orderId } });
  if (!reservation) return;
    await db.orderReservation.delete({ where: { orderId } });
    console.log(`[BalanceReservation] ➖ Released ${reservation.amount} ${reservation.asset} for ${orderId}`);
  } catch (err) {
    console.warn(`[BalanceReservation] releaseReservation failed for ${orderId}: ${err.message}`);
  }
}

async function releasePartialReservation(orderId, filledAmount) {
  const db = getDb();
  try {
    const reservation = await db.orderReservation.findUnique({ where: { orderId } });
  if (!reservation) return;

  const releaseAmt = Decimal.min(new Decimal(filledAmount), new Decimal(reservation.amount));
  const remaining = Decimal.max(new Decimal(reservation.amount).minus(releaseAmt), new Decimal(0));

  if (remaining.lte(0)) {
      await db.orderReservation.delete({ where: { orderId } });
  } else {
      await db.orderReservation.update({
        where: { orderId },
        data: { amount: remaining.toString() },
      });
  }
    console.log(`[BalanceReservation] ➖ Partially released ${filledAmount} ${reservation.asset} for ${orderId} (remaining: ${remaining.toString()})`);
  } catch (err) {
    console.warn(`[BalanceReservation] releasePartialReservation failed for ${orderId}: ${err.message}`);
  }
}

/**
 * Get the allocation contract ID stored for an order's reservation.
 */
async function getAllocationContractIdForOrder(orderId) {
  const db = getDb();
  const reservation = await db.orderReservation.findUnique({
    where: { orderId },
    select: { allocationContractId: true },
  });
  return reservation?.allocationContractId || null;
}

async function setAllocationContractIdForOrder(orderId, allocationContractId, allocationType = null) {
  const db = getDb();
  try {
    const data = { allocationContractId: allocationContractId || null };
    if (allocationType) data.allocationType = allocationType;
    await db.orderReservation.update({
      where: { orderId },
      data,
    });
  } catch (err) {
    console.warn(`[BalanceReservation] setAllocationContractId failed for ${orderId}: ${err.message}`);
  }
}

async function getAllocationTypeForOrder(orderId) {
  const db = getDb();
  const reservation = await db.orderReservation.findUnique({
    where: { orderId },
    select: { allocationType: true },
  });
  return reservation?.allocationType || 'EXCHANGE';
}

class OrderService {
  constructor() {
    console.log('[OrderService] Initialized with Canton JSON API v2 + Allocation-based settlement');
    console.log('[OrderService] Order placement pipeline: INTERACTIVE_3_STEP_V1 (1 command per interactive prepare — enforced in cantonService)');
  }

  _assertExecutorOauthConfigured() {
    tokenProvider.assertExecutorOauthConfigured();
  }

  _templateIdToString(templateId) {
    if (typeof templateId === 'string') return templateId;
    if (templateId && typeof templateId === 'object' && templateId.packageId && templateId.moduleName && templateId.entityName) {
      return `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;
    }
    return '';
  }

  _extractAllocationCidFromExecuteResult(result) {
    const isCidLike = (value) => typeof value === 'string' && value.length > 20;
    const visited = new Set();
    const stack = [result];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (isCidLike(current.allocationCid)) return current.allocationCid;
      if (isCidLike(current.allocationContractId)) return current.allocationContractId;

      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const key of Object.keys(current)) {
          stack.push(current[key]);
        }
      }
    }
    return null;
  }

  /**
   * Get or create the OrderPlacerFactory for a user.
   * Operator creates one per user at registration (or on first order if missing).
   * Cached in-memory to avoid repeated Canton queries.
   * Returns the contractId of the factory.
   */
  async _getOrCreateOrderPlacerFactory(partyId, operatorPartyId, packageId, serviceToken) {
    // In-memory cache: partyId → contractId
    if (!this._placerFactoryCache) this._placerFactoryCache = new Map();
    if (this._placerFactoryCache.has(partyId)) {
      return this._placerFactoryCache.get(partyId);
    }

    const templateId = `${packageId}:Settlement:OrderPlacerFactory`;
    // Query existing factory for this user (operator can see it as signatory)
    try {
      const contracts = await cantonService.queryActiveContracts(
        { party: operatorPartyId, templateIds: [templateId], pageSize: 200 },
        serviceToken
      );
      const list = Array.isArray(contracts) ? contracts : (contracts?.activeContracts || contracts?.contracts || []);
      for (const c of list) {
        const ev = c.createdEvent || c;
        const payload = ev?.createArguments || ev?.createArgument || ev?.payload || {};
        if (payload.user === partyId || payload.owner === partyId) {
          const cid = c.contractId || ev?.contractId;
          if (cid) {
            this._placerFactoryCache.set(partyId, cid);
            console.log(`[OrderService] ✅ OrderPlacerFactory found for ${partyId.substring(0, 24)}...: ${cid.substring(0, 20)}...`);
            return cid;
          }
        }
      }
    } catch (queryErr) {
      console.warn(`[OrderService] ⚠️ Factory query failed, will create: ${queryErr.message}`);
    }

    // Not found — create it now (operator-signed, non-interactive)
    console.log(`[OrderService] 🔄 Creating OrderPlacerFactory for ${partyId.substring(0, 24)}...`);
    const result = await cantonService.submitAndWaitForTransaction(serviceToken, {
      commands: {
        commandId: `create-placer-factory-${partyId.substring(0, 16)}-${Date.now()}`,
        actAs:     [operatorPartyId],
        readAs:    [operatorPartyId, partyId],
        domainId:  config.canton.synchronizerId,
        commands:  [{
          CreateCommand: {
            templateId,
            createArguments: {
              operator: operatorPartyId,
              user:     partyId,
            },
          },
        }],
      },
    });

    // Extract the new contractId from the transaction events
    let newCid = null;
    const events = result?.transaction?.events || result?.events || [];
    for (const ev of events) {
      const created = ev.created || ev.CreatedEvent || ev;
      if (created?.contractId && (created?.templateId?.includes?.('OrderPlacerFactory') || JSON.stringify(created?.templateId)?.includes('OrderPlacerFactory'))) {
        newCid = created.contractId;
        break;
      }
    }
    if (!newCid && result?.transaction?.updateId) {
      // Fallback: if we can't parse from events, query again
      const retryContracts = await cantonService.queryActiveContracts(
        { party: operatorPartyId, templateIds: [templateId], pageSize: 200 },
        serviceToken
      );
      const retryList = Array.isArray(retryContracts) ? retryContracts : (retryContracts?.activeContracts || []);
      for (const c of retryList) {
        const ev = c.createdEvent || c;
        const payload = ev?.createArguments || ev?.createArgument || ev?.payload || {};
        if (payload.user === partyId || payload.owner === partyId) {
          newCid = c.contractId || ev?.contractId;
          break;
        }
      }
    }
    if (!newCid) throw new Error(`Failed to get OrderPlacerFactory contractId for ${partyId}`);

    this._placerFactoryCache.set(partyId, newCid);
    console.log(`[OrderService] ✅ OrderPlacerFactory created for ${partyId.substring(0, 24)}...: ${newCid.substring(0, 20)}...`);
    return newCid;
  }

  /**
   * Parse CreatedEvent contract IDs from an interactive execute response.
   * Distinguishes lock / token allocations from ExchangeAllocation (step 3).
   */
  _parseCreatedCidsFromInteractiveExecute(result) {
    let orderCid = null;
    let lockAllocationCid = null;
    let exchangeAllocationCid = null;
    for (const event of result.transaction?.events || []) {
      const created = event.created || event.CreatedEvent;
      if (!created?.contractId) continue;
      const tid = this._templateIdToString(created?.templateId);
      if (tid.includes(':Order:Order')) {
        orderCid = created.contractId;
        continue;
      }
      if (tid.includes('ExchangeAllocation')) {
        exchangeAllocationCid = created.contractId;
        continue;
      }
      if (tid.includes('Allocation')) {
        lockAllocationCid = created.contractId;
      }
    }
    return { orderCid, lockAllocationCid, exchangeAllocationCid };
  }

  _extractOrderRefFromAllocationPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return (
      payload?.orderId ||
      payload?.settlement?.settlementRef?.id ||
      payload?.allocation?.settlement?.settlementRef?.id ||
      payload?.settlementRef?.id ||
      payload?.allocation?.settlementRef?.id ||
      payload?.transferLegId ||
      payload?.allocation?.transferLegId ||
      payload?.output?.allocation?.settlement?.settlementRef?.id ||
      payload?.output?.allocation?.transferLegId ||
      null
    );
  }

  async _findAllocationCidForOrder(orderId, partyId, token) {
    if (!orderId) return null;
    const operatorPartyId = config.canton.operatorPartyId;
    const parties = [...new Set([partyId, operatorPartyId].filter(Boolean))];

    // 1) First attempt: use SDK pending-allocation view (narrow, deterministic, and fast).
    try {
      const sdkClient = getCantonSDKClient();
      if (sdkClient?.isReady?.()) {
        for (const party of parties) {
          const pending = await sdkClient.fetchPendingAllocations(party);
          for (const row of Array.isArray(pending) ? pending : []) {
            const contractId = row?.contractId || row?.activeContract?.createdEvent?.contractId || null;
            const payload =
              row?.activeContract?.createdEvent?.createArgument ||
              row?.payload ||
              row?.createArgument ||
              {};
            const ref = this._extractOrderRefFromAllocationPayload(payload);
            if (ref === orderId && contractId) {
              console.log(`[OrderService] ✅ Found allocation via SDK pending view for ${orderId}: ${contractId.substring(0, 30)}...`);
              return contractId;
            }
          }
        }
      }
    } catch (sdkErr) {
      console.warn(`[OrderService] SDK pending-allocation lookup failed: ${sdkErr.message}`);
    }

    // 2) Fallback: raw ACS query. Retry briefly for eventual-consistency lag after execute.
    const attempts = 4;
    for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const party of parties) {
      try {
        const contracts = await cantonService.queryActiveContracts({
          party,
          templateIds: [],
          verbose: true,
        }, token);

        for (const contract of Array.isArray(contracts) ? contracts : []) {
          const templateId = this._templateIdToString(contract.templateId || contract.identifier);
          if (!templateId.includes('Allocation')) continue;

          const payload = contract.payload || contract.createArgument || {};
          const settlementRefId = this._extractOrderRefFromAllocationPayload(payload);

          if (settlementRefId === orderId && contract.contractId) {
            console.log(`[OrderService] ✅ Found allocation for order ${orderId}: ${contract.contractId.substring(0, 30)}...`);
            return contract.contractId;
          }

          // Defensive fallback: token-standard payloads can vary across package versions.
          // If the payload references the orderId anywhere, treat this as the matching allocation.
          if (contract.contractId && JSON.stringify(payload).includes(orderId)) {
            console.log(`[OrderService] ✅ Found allocation via payload scan for order ${orderId}: ${contract.contractId.substring(0, 30)}...`);
            return contract.contractId;
          }
        }
      } catch (err) {
        console.warn(`[OrderService] Allocation lookup failed for party ${party.substring(0, 20)}...: ${err.message}`);
      }
    }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return null;
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
      const reserved = await getReservedBalance(partyId, asset);
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

    // Find the allocationContractId from the reservation if not provided
    if (!allocationContractId) {
      allocationContractId = await getAllocationContractIdForOrder(orderId);
    }

    if (!allocationContractId) {
      console.log(`[OrderService] No allocationContractId for order ${orderId} — nothing to cancel`);
      return;
    }
    
    const executorPartyId = config.canton.operatorPartyId;
    const sdkClient = getCantonSDKClient();

    try {
      const cancelResult = await sdkClient.cancelAllocation(allocationContractId, partyId, executorPartyId);
      if (cancelResult?.cancelled) {
        console.log(`[OrderService] Allocation cancelled for order ${orderId} — holdings unlocked`);
      } else if (cancelResult?.skipped) {
        console.log(`[OrderService] Allocation cancel skipped for order ${orderId}: ${cancelResult.reason}`);
      } else {
        console.warn(`[OrderService] Allocation cancel not confirmed for order ${orderId}`);
      }
      return cancelResult;
    } catch (cancelErr) {
      console.warn(`[OrderService] ⚠️ Could not cancel Allocation: ${cancelErr.message}`);
      // Don't throw — order cancellation should still proceed
      return { cancelled: false, skipped: false, reason: cancelErr.message };
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

    // Service token: operator submissions (TX2 Order create) and broad ledger queries.
    const serviceToken = await tokenProvider.getServiceToken();
    // Executor OAuth client: per onboarding, user-party rights (CanActAs / submit interactive
    // completion for ext users) are granted to THIS client — same as AutoAccept / transfer-offer
    // prepare. Using the service token for prepare but not execute caused HTTP 403
    // (PERMISSION_DENIED, masked as "security-sensitive") on /interactive-submission/execute.
    this._assertExecutorOauthConfigured();
    const interactiveLedgerToken = await tokenProvider.getExecutorToken();
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
        serviceToken, 
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
    // STEP A: Balance verified — reserve locked amount in memory
    // For external parties, the actual Allocation authorization is done
    // in the interactive order-placement transaction prepared below.
    // ═══════════════════════════════════════════════════════════════════
    let allocationContractId = null;

    // ═══ RESERVE BALANCE to prevent overselling ═══
    await addReservation(orderId, partyId, lockInfo.asset, lockInfo.amount, allocationContractId);

    // Determine initial order status
    // STOP_LOSS orders start as 'PENDING_TRIGGER' — NOT added to active order book
    const initialStatus = orderMode === 'STOP_LOSS' ? 'PENDING_TRIGGER' : 'OPEN';

    // Create Order contract on Canton
    const timestamp = new Date().toISOString();

    // Interactive /v2/interactive-submission/prepare: one DAML command per request (participant limit).
    // Placement is therefore: (1) allocate → (2) create Order → (3) create ExchangeAllocation,
    // each with its own prepare + external sign + execute. Matching/settlement stays server-driven later.

    const sdkClient = getCantonSDKClient();
    let allocationCommand = null;
    let readAs = null;
    let disclosedContracts = [];
    let synchronizerId = null;
    let allocationType = null;
    let exactAmountHoldingCid = null;

    // ═══ EXECUTOR: always use operatorPartyId for Splice allocation executor ═══
    // Settlement uses actAs=[operator] with Execute_LegSettlement (controller=executor on ExchangeAllocation).
    // Allocation_ExecuteTransfer needs [executor, sender, receiver]. With receiver=executor=operator:
    //   alloc: [operator, user, operator] = {operator, user} — covered by EA auth carry-forward ✓
    // Using Cardiv (EXECUTOR_PARTY_ID) here would break the chain because settlement
    // submits with actAs=[operator], not Cardiv.
    const executorPartyId = operatorPartyId;

    // ═══ OPERATOR-AS-RECEIVER: sender=user, receiver=operator (executor) ═══
    // Fixes "Sender and receiver must be different parties" error from Utility Registry (CBTC).
    // Tokens flow user→operator at Execute_LegSettlement; operator forwards to counterparty.
    console.log(`[OrderService] 🔄 Creating operator-as-receiver allocation (sender=user, receiver=operator, executor=${executorPartyId.substring(0, 30)}...)`);
    const realAlloc = await sdkClient.tryBuildRealAllocationCommand(
      partyId,
      operatorPartyId,  // operator as executor AND receiver — must match settlement actAs
      String(lockInfo.amount),
      lockInfo.asset,
      orderId,
      null  // Use existing holdings
    );

    if (!realAlloc) {
      throw new Error(`Cannot place order: failed to create Token Standard allocation for ${lockInfo.amount} ${lockInfo.asset}. Tokens must be locked on-chain before an order can be placed.`);
    }

    allocationCommand = realAlloc.command;
    readAs = [...new Set([operatorPartyId, partyId, ...(realAlloc.readAs || [])])];
    disclosedContracts = realAlloc.disclosedContracts || [];
    synchronizerId = realAlloc.synchronizerId || config.canton.synchronizerId;
    allocationType = realAlloc.allocationType;
    console.log(`[OrderService] ✅ Operator-as-receiver allocation command built for ${orderId} (executor=${executorPartyId.substring(0, 30)}...)`);

    // Store the allocation type with the reservation
    await setAllocationContractIdForOrder(orderId, null, allocationType);

    // ═══════════════════════════════════════════════════════════════════
    // 3-TX PLACEMENT (participant constraint):
    // Many Canton participants reject interactive prepare with multiple commands
    // ("Preparing multiple commands is currently not supported"). We therefore use
    // three sequential prepare→sign→execute rounds: allocation → Order → ExchangeAllocation.
    // The frontend already chains when execute-place returns requiresSignature again.
    // ═══════════════════════════════════════════════════════════════════
    const orderStatus = orderMode === 'STOP_LOSS' ? 'PENDING_TRIGGER' : 'OPEN';
    const orderCreateArgs = {
      orderId,
      owner: partyId,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      tradingPair,
      price: orderMode.toUpperCase() === 'LIMIT' && price ? String(price) : null,
      quantity: String(quantity),
      filled: '0.0',
      status: orderStatus,
      timestamp,
      operator: operatorPartyId,
      allocationCid: orderId,
      stopPrice: stopPrice ? String(stopPrice) : null,
    };

    const exchangeAllocationCreateArgs = {
      allocationId: `ea-${orderId}`,
      orderId,
      owner: partyId,
      executor: operatorPartyId,
      amount: String(lockInfo.amount),
      instrumentSymbol: lockInfo.asset,
      side: orderType.toUpperCase(),
      tradingPair,
      status: 'PENDING',
      createdAt: timestamp,
    };

    const placementContext = {
      packageId,
      readAs,
      synchronizerId,
      disclosedContracts,
      orderCreateArgs,
      exchangeAllocationCreateArgs,
      executorPartyId,
      /** Same as orderCreateArgs.operator — needed for actAs on Order create (multi-signatory on deployed DAR). */
      operatorPartyId,
    };

    // ═══════════════════════════════════════════════════════════════════
    // 1-TX PLACEMENT — ExerciseCommand on OrderPlacerFactory::PlaceOrder
    //
    // Client requirement: order placement = 1 user-signed TX.
    //
    // WHY NOT CreateAndExercise:
    //   CreateAndExercise produces 2 root nodes (Create + Exercise).
    //   Canton interactive submission only supports 1 root node → rejected.
    //
    // FIX (mirrors ExchangeSettlerHub for settlement):
    //   Operator pre-creates one OrderPlacerFactory contract per user.
    //   User exercises nonconsuming PlaceOrder on the existing factory.
    //   ExerciseCommand on pre-existing contract = 1 root node ✓
    //
    // DAML auth: PlaceOrder.controller = user satisfies:
    //   AllocationFactory_Allocate.controller = user (sender = receiver) ✓
    //   Order.create signatory = user (owner) ✓
    //   ExchangeAllocation.create signatory = user (owner) ✓
    // ═══════════════════════════════════════════════════════════════════
    const allocExercise = allocationCommand?.ExerciseCommand || allocationCommand;
    const factoryCid    = allocExercise?.contractId;
    const allocArgs     = allocExercise?.choiceArgument || {};

    if (!factoryCid) {
      throw new Error('Could not extract allocation factory CID from allocation command');
    }

    // Get or create the per-user OrderPlacerFactory contract (operator-signed singleton)
    const placerFactoryCid = await this._getOrCreateOrderPlacerFactory(partyId, operatorPartyId, packageId, serviceToken);

    const exerciseCmd = {
      ExerciseCommand: {
        templateId:  `${packageId}:Settlement:OrderPlacerFactory`,
        contractId:  placerFactoryCid,
        choice:      'PlaceOrder',
        choiceArgument: {
          orderId,
          allocFactory:     factoryCid,
          expectedAdmin:    allocArgs.expectedAdmin,
          allocationSpec:   allocArgs.allocation,
          inputHoldingCids: allocArgs.inputHoldingCids,
          allocExtraArgs:   allocArgs.extraArgs,
          orderType:        orderType.toUpperCase(),
          orderMode:        orderMode.toUpperCase(),
          tradingPair,
          price:     (orderMode.toUpperCase() === 'LIMIT' && price)
                       ? price.toString() : null,
          quantity:  quantity.toString(),
          stopPrice: stopPrice ? stopPrice.toString() : null,
          lockAmount:       lockInfo.amount.toString(),
          instrumentSymbol: lockInfo.asset,
        },
      },
    };

    console.log(`[OrderService] 🔄 Preparing 1-TX placement: ExerciseCommand OrderPlacerFactory::PlaceOrder (1 root node, 1 user signature)`);
    const prepareResult = await cantonService.prepareInteractiveSubmission({
      token: interactiveLedgerToken,
      actAsParty: [partyId],
      commands: [exerciseCmd],
      readAs,
      synchronizerId,
      disclosedContracts,
    });

    if (!prepareResult.preparedTransaction || !prepareResult.preparedTransactionHash) {
      throw new Error('Prepare returned incomplete result: missing preparedTransaction or preparedTransactionHash');
    }

    console.log(`[OrderService] ✅ 1-TX placement prepared. Hash to sign: ${prepareResult.preparedTransactionHash.substring(0, 40)}...`);

    return {
      requiresSignature: true,
      step:  'PLACEMENT_STEP_1_COMPLETE',
      stage: 'PLACEMENT_STEP_1_COMPLETE',
      orderId,
      tradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price:     orderMode.toUpperCase() === 'LIMIT' && price ? price.toString() : (stopPrice ? stopPrice.toString() : null),
      quantity:  quantity.toString(),
      stopPrice: stopPrice || null,
      preparedTransaction:     prepareResult.preparedTransaction,
      preparedTransactionHash: prepareResult.preparedTransactionHash,
      hashingSchemeVersion:    prepareResult.hashingSchemeVersion,
      partyId,
      lockInfo,
      executorPartyId,
      allocationType,
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
   * STEP 2: Execute a prepared order placement with the user's signature
   * 
   * Called after the frontend signs the preparedTransactionHash from placeOrder()
   * 
   * @param {string} preparedTransaction - Opaque blob from prepare step
   * @param {string} partyId - The external party that signed
   * @param {string} signatureBase64 - User's Ed25519 signature of preparedTransactionHash
   * @param {string} signedBy - Public key fingerprint that signed
   * @param {string|number} hashingSchemeVersion - From prepare response
   * @param {object} orderMeta - { orderId, tradingPair, orderType, orderMode, price, quantity, stopPrice, lockInfo }
   * @returns {Object} Order result with contractId
   */
  async executeOrderPlacement(preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, orderMeta = {}) {
    const serviceToken = await tokenProvider.getServiceToken();
    this._assertExecutorOauthConfigured();
    const interactiveLedgerToken = await tokenProvider.getExecutorToken();
    const operatorPartyId = config.canton.operatorPartyId;
    
    try {
      const stage = orderMeta?.stage || 'PLACEMENT_STEP_1_ALLOCATION';
      console.log(`[OrderService] EXECUTE order placement for ${partyId.substring(0, 30)}... (stage: ${stage})`);

      if (stage === 'ALLOCATION_AND_ORDER_PREPARED') {
        throw new ValidationError(
          'Order placement format is outdated. Please place the order again (three signing steps).'
        );
      }
      if (stage === 'ALLOCATION_PREPARED') {
        throw new ValidationError(
          'Legacy placement step is no longer supported. Please place the order again.'
        );
      }

      const partySignatures = {
        signatures: [
          {
            party: partyId,
            signatures: [{
              format: 'SIGNATURE_FORMAT_RAW',
              signature: signatureBase64,
              signedBy: signedBy,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519'
            }]
          }
        ]
      };

      const sigParty = partySignatures.signatures[0]?.party;
      if (sigParty !== partyId) {
        throw new ValidationError('Placement execute: signature entry must be for the requesting user party only.');
      }

      const result = await cantonService.executeInteractiveSubmission({
        preparedTransaction,
        partySignatures,
        hashingSchemeVersion,
      }, interactiveLedgerToken);

      const parsed = this._parseCreatedCidsFromInteractiveExecute(result);

      // ─── Step 1 done: allocation on-chain → prepare Order create ───
      if (stage === 'PLACEMENT_STEP_1_ALLOCATION') {
        let allocationContractId = parsed.lockAllocationCid
          || this._extractAllocationCidFromExecuteResult(result);

        if (!allocationContractId && orderMeta.orderId) {
          console.log(`[OrderService] Step 1: allocation CID not in events, searching...`);
          try {
            allocationContractId = await this._findAllocationCidForOrder(orderMeta.orderId, partyId, serviceToken);
          } catch (searchErr) {
            console.warn(`[OrderService] Allocation CID search failed: ${searchErr.message}`);
          }
        }

        if (!allocationContractId) {
          throw new ValidationError('Could not resolve allocation contract id after step 1. Try again.');
        }

        if (orderMeta.orderId) {
          const allocType = orderMeta.allocationType || null;
          await setAllocationContractIdForOrder(orderMeta.orderId, allocationContractId, allocType);
          console.log(`[OrderService] ✅ Step 1: allocation linked to order ${orderMeta.orderId}: ${allocationContractId.substring(0, 30)}...`);

          try {
            const sdkClient = getCantonSDKClient();
            const holdingState = await sdkClient.verifyHoldingState(partyId, orderMeta.lockInfo?.asset);
            console.log(`[OrderService] Holding verification after allocation: ${holdingState.totalAvailable} available, ${holdingState.totalLocked} locked (${orderMeta.lockInfo?.asset})`);
          } catch (verifyErr) {
            console.warn(`[OrderService] Post-allocation holding verification skipped: ${verifyErr.message}`);
          }
        }

        const ctx = orderMeta.placementContext;
        if (!ctx?.packageId || !ctx.orderCreateArgs) {
          throw new ValidationError('Missing placementContext from place step — please place the order again.');
        }

        const mergedOrderArgs = {
          ...ctx.orderCreateArgs,
          allocationCid: allocationContractId,
        };

        // Order.daml has `signatory owner` (user), `observer operator`.
        // Only the user (owner) needs to sign — operator is not a signatory.
        // actAsParty must only include signatories; using interactiveLedgerToken
        // which has CanActAs rights for external parties.
        const readAsOrder = [...new Set([...(ctx.readAs || []), partyId, config.canton.operatorPartyId].filter(Boolean))];

        console.log(`[OrderService] 🔄 Preparing interactive submission: step 2/3 — Order create (actAs: user only, signatory=owner)`);
        const prepare2 = await cantonService.prepareInteractiveSubmission({
          token: interactiveLedgerToken,
          actAsParty: [partyId],
          commands: [{
            CreateCommand: {
              templateId: `${ctx.packageId}:Order:Order`,
              createArguments: mergedOrderArgs,
            },
          }],
          readAs: readAsOrder,
          synchronizerId: ctx.synchronizerId,
          disclosedContracts: ctx.disclosedContracts,
        });

        return {
          success: true,
          requiresSignature: true,
          usedInteractiveSubmission: true,
          step: 'PLACEMENT_STEP_2_ORDER',
          stage: 'PLACEMENT_STEP_2_ORDER',
          preparedTransaction: prepare2.preparedTransaction,
          preparedTransactionHash: prepare2.preparedTransactionHash,
          hashingSchemeVersion: prepare2.hashingSchemeVersion,
          orderId: orderMeta.orderId,
          tradingPair: orderMeta.tradingPair,
          orderType: orderMeta.orderType,
          orderMode: orderMeta.orderMode,
          price: orderMeta.price,
          quantity: orderMeta.quantity,
          stopPrice: orderMeta.stopPrice || null,
          lockInfo: orderMeta.lockInfo,
          allocationType: orderMeta.allocationType,
          allocationContractId,
          placementContext: ctx,
          partyId,
        };
      }

      // ─── Step 2 done: Order on-chain → prepare ExchangeAllocation create ───
      if (stage === 'PLACEMENT_STEP_2_ORDER') {
        let orderContractId = parsed.orderCid;
        if (!orderContractId) {
          const txUpdateId = result.transaction?.updateId || result.updateId;
          if (txUpdateId && /^[0-9a-f]{40,}$/i.test(txUpdateId)) {
            orderContractId = txUpdateId;
          }
        }
        if (!orderContractId) {
          orderContractId = `${orderMeta.orderId}-pending`;
          console.warn(`[OrderService] Step 2: Order contract id not in events — using pending id until stream confirms`);
        }

        const ctx = orderMeta.placementContext;
        if (!ctx?.packageId || !ctx.exchangeAllocationCreateArgs) {
          throw new ValidationError('Missing placementContext — please place the order again.');
        }

        console.log(`[OrderService] 🔄 Preparing interactive submission: step 3/3 — ExchangeAllocation create`);
        const prepare3 = await cantonService.prepareInteractiveSubmission({
          token: interactiveLedgerToken,
          actAsParty: [partyId],
          commands: [{
            CreateCommand: {
              templateId: `${ctx.packageId}:Settlement:ExchangeAllocation`,
              createArguments: ctx.exchangeAllocationCreateArgs,
            },
          }],
          readAs: ctx.readAs,
          synchronizerId: ctx.synchronizerId,
          disclosedContracts: ctx.disclosedContracts,
        });

        return {
          success: true,
          requiresSignature: true,
          usedInteractiveSubmission: true,
          step: 'PLACEMENT_STEP_3_EXCHANGE',
          stage: 'PLACEMENT_STEP_3_EXCHANGE',
          preparedTransaction: prepare3.preparedTransaction,
          preparedTransactionHash: prepare3.preparedTransactionHash,
          hashingSchemeVersion: prepare3.hashingSchemeVersion,
          orderId: orderMeta.orderId,
          tradingPair: orderMeta.tradingPair,
          orderType: orderMeta.orderType,
          orderMode: orderMeta.orderMode,
          price: orderMeta.price,
          quantity: orderMeta.quantity,
          stopPrice: orderMeta.stopPrice || null,
          lockInfo: orderMeta.lockInfo,
          allocationType: orderMeta.allocationType,
          allocationContractId: orderMeta.allocationContractId,
          orderContractId,
          placementContext: ctx,
          partyId,
        };
      }

      // ─── Step 3 done: ExchangeAllocation on-chain → placement complete ───
      if (stage === 'PLACEMENT_STEP_3_EXCHANGE') {
        const orderContractId = orderMeta.orderContractId || null;
        let contractId = orderContractId || `${orderMeta.orderId}-pending`;
        const hasRealCid = !!(orderContractId && !String(orderContractId).endsWith('-pending'));
        if (!orderContractId) {
          console.warn(`[OrderService] Step 3: missing orderContractId in orderMeta — using pending id until stream confirms`);
        }

        console.log(`[OrderService] ✅ Order placement complete (3/3): ${orderMeta.orderId} (order cid: ${hasRealCid ? contractId.substring(0, 30) + '...' : 'pending — WebSocket will deliver'})`);

        const finalAllocationCid = orderMeta.allocationContractId || null;
        const orderRecord = {
          contractId,
          orderId: orderMeta.orderId,
          owner: partyId,
          tradingPair: orderMeta.tradingPair,
          orderType: orderMeta.orderType,
          orderMode: orderMeta.orderMode,
          price: orderMeta.price,
          stopPrice: orderMeta.stopPrice || null,
          quantity: orderMeta.quantity,
          filled: '0',
          status: orderMeta.orderMode === 'STOP_LOSS' ? 'PENDING_TRIGGER' : 'OPEN',
          timestamp: new Date().toISOString(),
          lockId: null,
          lockedAmount: orderMeta.lockInfo?.amount || '0',
          lockedAsset: orderMeta.lockInfo?.asset || '',
          allocationContractId: finalAllocationCid,
        };

        if (orderRecord.status === 'OPEN') {
          registerOpenOrders([orderRecord]);
        }

        if (global.broadcastWebSocket && orderRecord.status === 'OPEN') {
          global.broadcastWebSocket(`orderbook:${orderMeta.tradingPair}`, {
            type: 'NEW_ORDER',
            orderId: orderMeta.orderId,
            contractId: contractId,
            owner: partyId,
            orderType: orderMeta.orderType,
            orderMode: orderMeta.orderMode,
            price: orderMeta.price,
            quantity: orderMeta.quantity,
            remaining: orderMeta.quantity,
            tradingPair: orderMeta.tradingPair,
            timestamp: new Date().toISOString()
          });
        }

        return {
          success: true,
          usedInteractiveSubmission: true,
          orderId: orderMeta.orderId,
          contractId,
          status: orderRecord.status,
          tradingPair: orderMeta.tradingPair,
          orderType: orderMeta.orderType,
          orderMode: orderMeta.orderMode,
          price: orderMeta.price,
          stopPrice: orderMeta.stopPrice || null,
          quantity: orderMeta.quantity,
          filled: '0',
          remaining: orderMeta.quantity,
          allocationContractId: finalAllocationCid,
          timestamp: new Date().toISOString()
        };
      }

      // ─── 1-TX complete: all 3 ops happened in single CreateAndExercise TX ───
      if (stage === 'PLACEMENT_STEP_1_COMPLETE') {
        const parsed = this._parseCreatedCidsFromInteractiveExecute(result);

        // Extract the Splice allocation CID from the execute response events (fast path).
        // If not present, launch a background lookup — do NOT await it here because the
        // fallback uses a WebSocket ACS query that can take up to 60 s to resolve, which
        // would hold the HTTP response past the frontend's 60 s axios timeout.
        let allocationCid = parsed.lockAllocationCid;

        if (allocationCid && orderMeta.orderId) {
          const allocType = orderMeta.allocationType || null;
          await setAllocationContractIdForOrder(orderMeta.orderId, allocationCid, allocType);
          console.log(`[OrderService] ✅ 1-TX: Splice alloc CID stored for ${orderMeta.orderId}: ${allocationCid.substring(0, 30)}...`);
        } else if (orderMeta.orderId) {
          // Fire-and-forget: resolve allocation CID in background after TX confirms on ledger.
          const _bgOrderId = orderMeta.orderId;
          const _bgAllocType = orderMeta.allocationType || null;
          this._findAllocationCidForOrder(_bgOrderId, partyId, serviceToken)
            .then(async (cid) => {
              if (cid) {
                await setAllocationContractIdForOrder(_bgOrderId, cid, _bgAllocType).catch(() => {});
                console.log(`[OrderService] ✅ 1-TX (async): alloc CID stored for ${_bgOrderId}: ${cid.substring(0, 30)}...`);
              }
            })
            .catch(() => {});
        }

        const orderContractId = parsed.orderCid || `${orderMeta.orderId}-pending`;
        const hasRealCid = !!(parsed.orderCid && !String(parsed.orderCid).endsWith('-pending'));
        console.log(`[OrderService] ✅ 1-TX placement complete: order ${orderMeta.orderId} (cid: ${hasRealCid ? orderContractId.substring(0, 30) + '...' : 'pending — WebSocket will confirm'})`);

        const orderStatus = orderMeta.orderMode === 'STOP_LOSS' ? 'PENDING_TRIGGER' : 'OPEN';
        const orderRecord = {
          contractId:          orderContractId,
          orderId:             orderMeta.orderId,
          owner:               partyId,
          tradingPair:         orderMeta.tradingPair,
          orderType:           orderMeta.orderType,
          orderMode:           orderMeta.orderMode,
          price:               orderMeta.price,
          stopPrice:           orderMeta.stopPrice || null,
          quantity:            orderMeta.quantity,
          filled:              '0',
          status:              orderStatus,
          timestamp:           new Date().toISOString(),
          allocationContractId: allocationCid,
        };

        if (orderStatus === 'OPEN') registerOpenOrders([orderRecord]);

        if (global.broadcastWebSocket && orderStatus === 'OPEN') {
          global.broadcastWebSocket(`orderbook:${orderMeta.tradingPair}`, {
            type:       'NEW_ORDER',
            orderId:    orderMeta.orderId,
            contractId: orderContractId,
            owner:      partyId,
            orderType:  orderMeta.orderType,
            orderMode:  orderMeta.orderMode,
            price:      orderMeta.price,
            quantity:   orderMeta.quantity,
            remaining:  orderMeta.quantity,
            tradingPair: orderMeta.tradingPair,
            timestamp:  new Date().toISOString(),
          });
        }

        // Register stop-loss monitoring if applicable
        if (orderMeta.orderMode === 'STOP_LOSS' && orderMeta.stopPrice) {
          try {
            const { getStopLossService } = require('./stopLossService');
            await getStopLossService().registerStopLoss({
              orderContractId: orderContractId,
              orderId:         orderMeta.orderId,
              tradingPair:     orderMeta.tradingPair,
              orderType:       orderMeta.orderType,
              stopPrice:       orderMeta.stopPrice,
              partyId,
              quantity:        orderMeta.quantity,
              allocationContractId: allocationCid,
            });
            console.log(`[OrderService] ✅ Stop-loss registered for ${orderMeta.orderId}`);
          } catch (slErr) {
            console.warn(`[OrderService] ⚠️ Stop-loss registration failed (non-critical): ${slErr.message}`);
          }
        }

        return {
          success:               true,
          usedInteractiveSubmission: true,
          requiresSignature:     false,        // ← 1 TX done, no more signing
          orderId:               orderMeta.orderId,
          contractId:            orderContractId,
          status:                orderStatus,
          tradingPair:           orderMeta.tradingPair,
          orderType:             orderMeta.orderType,
          orderMode:             orderMeta.orderMode,
          price:                 orderMeta.price,
          stopPrice:             orderMeta.stopPrice || null,
          quantity:              orderMeta.quantity,
          filled:                '0',
          remaining:             orderMeta.quantity,
          allocationContractId:  allocationCid,
          timestamp:             new Date().toISOString(),
        };
      }

      throw new ValidationError(`Unknown placement stage: ${stage}. Please place the order again.`);
    } catch (error) {
      console.error('[OrderService] Failed to execute order placement:', error.message);

      if (orderMeta.orderId) {
        await releaseReservation(orderMeta.orderId);
      }
      throw error;
    }
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

    const serviceToken = await tokenProvider.getServiceToken();
    this._assertExecutorOauthConfigured();
    const interactiveLedgerToken = await tokenProvider.getExecutorToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID is not configured');
    }

    // First, get the order details to know what was locked
    let orderDetails = null;
    try {
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: templateIdsToQuery,
        pageSize: 200
      }, serviceToken);
      
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
      const payloadAllocationCid = orderDetails?.allocationCid;
      const isRealCid = typeof payloadAllocationCid === 'string' && payloadAllocationCid.length > 20 && !payloadAllocationCid.startsWith('#');
      const allocationCid = isRealCid
        ? payloadAllocationCid
        : await getAllocationContractIdForOrder(orderId_cancel);
      if (allocationCid) {
        try {
          const allocationCancelResult = await this.cancelAllocationForOrder(orderId_cancel, allocationCid, partyId);
          if (allocationCancelResult?.cancelled) {
            console.log(`[OrderService] ✅ Allocation cancelled — funds released`);
          } else if (allocationCancelResult?.skipped) {
            console.log(`[OrderService] ⏭️ Allocation cancel skipped: ${allocationCancelResult.reason}`);
          } else {
            console.warn('[OrderService] ⚠️ Allocation cancel not confirmed; continuing with interactive order cancel');
          }
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
        await stopLossService.unregisterStopLoss(orderContractId);
        console.log(`[OrderService] ✅ Stop-loss unregistered for cancelled order`);
      } catch (slErr) {
        console.warn(`[OrderService] ⚠️ Could not unregister stop-loss: ${slErr.message}`);
      }
    }

    // CancelOrder: controller is owner only (Order.daml). Interactive submission requires an
    // external signature for EVERY party in actAs. The operator is signatory but hosted on the
    // participant — do NOT list operator in actAs or Canton errors with "actAs parties did not
    // provide an external signature" for the operator party (see canton-sdk-client settlement notes).
    // actAs = owner only; readAs keeps operator + owner visibility for ACS/disclosure.
    console.log(`[OrderService] Preparing CancelOrder for interactive signing (actAs owner only)`);
    
    let prepareResult;
    try {
      prepareResult = await cantonService.prepareInteractiveSubmission({
      token: interactiveLedgerToken,
      actAsParty: [partyId],
      templateId: `${packageId}:Order:Order`,
      contractId: orderContractId,
      choice: 'CancelOrder',
      choiceArgument: {},
      readAs: [operatorPartyId, partyId],
    });
    } catch (prepErr) {
      const prepMsg = String(prepErr?.message || prepErr || '');
      // After uploading a new DAR/package-id, some participant informees may not yet be vetted
      // on the prescribed synchronizer. In that case Canton rejects interactive prepare with:
      // INVALID_PRESCRIBED_SYNCHRONIZER_ID ... has not vetted <packageId>.
      if (
        prepMsg.includes('INVALID_PRESCRIBED_SYNCHRONIZER_ID') &&
        prepMsg.toLowerCase().includes('has not vetted')
      ) {
        console.warn(
          `[OrderService] Preparing CancelOrder failed due to package vetting. Will vet package ${packageId.substring(0, 10)}... and retry once...`
        );
        const adminToken = await tokenProvider.getServiceToken();
        const CantonGrpcClient = require('./canton-grpc-client');
        const grpcClient = new CantonGrpcClient();
        await grpcClient.vetPackage(packageId, adminToken, config.canton.synchronizerId);

        // Retry interactive prepare once
        prepareResult = await cantonService.prepareInteractiveSubmission({
          token: interactiveLedgerToken,
          actAsParty: [partyId],
          templateId: `${packageId}:Order:Order`,
          contractId: orderContractId,
          choice: 'CancelOrder',
          choiceArgument: {},
          readAs: [operatorPartyId, partyId],
        });
      }

      if (prepErr.message?.includes('CONTRACT_NOT_FOUND') || prepErr.message?.includes('could not be found')) {
        console.warn(`[OrderService] Order contract already consumed/archived — treating as cancelled`);
        const readModel = getReadModelService();
        if (readModel) readModel.removeOrder(orderContractId);
        _globalOpenOrders.delete(orderContractId);
        if (orderDetails?.orderId) await releaseReservation(orderDetails.orderId);

        // Broadcast eviction via WebSocket so frontend removes the stale order
        if (global.broadcastWebSocket) {
          const tp = orderDetails?.tradingPair || tradingPair;
          if (tp) {
            global.broadcastWebSocket(`orderbook:${tp}`, {
              type: 'ORDER_CANCELLED',
              contractId: orderContractId,
              orderId: orderDetails?.orderId,
              tradingPair: tp,
              timestamp: new Date().toISOString(),
            });
          }
          if (partyId) {
            global.broadcastWebSocket(`orders:${partyId}`, {
              type: 'ORDER_ARCHIVED',
              contractId: orderContractId,
              orderId: orderDetails?.orderId,
              timestamp: new Date().toISOString(),
            });
          }
        }

        return {
          cancelled: true,
          alreadyArchived: true,
          orderContractId,
          orderId: orderDetails?.orderId,
          message: 'Order contract was already consumed (filled or archived). No action needed.',
        };
      }
      throw prepErr;
    }
    
    if (!prepareResult.preparedTransaction || !prepareResult.preparedTransactionHash) {
      throw new Error('Prepare returned incomplete result for CancelOrder');
    }
    
    console.log(`[OrderService] ✅ CancelOrder prepared. Hash to sign: ${prepareResult.preparedTransactionHash.substring(0, 40)}...`);
    
    return {
      requiresSignature: true,
      step: 'PREPARED',
      action: 'CANCEL',
      orderContractId,
      orderId: orderDetails?.orderId,
      tradingPair: orderDetails?.tradingPair || tradingPair,
      preparedTransaction: prepareResult.preparedTransaction,
      preparedTransactionHash: prepareResult.preparedTransactionHash,
      hashingSchemeVersion: prepareResult.hashingSchemeVersion,
      partyId,
      orderDetails,
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
   * STEP 2: Execute a prepared order cancellation with the user's signature
   * 
   * Called after the frontend signs the preparedTransactionHash from cancelOrder()
   * 
   * @param {string} preparedTransaction - Opaque blob from prepare step
   * @param {string} partyId - The external party that signed
   * @param {string} signatureBase64 - User's Ed25519 signature
   * @param {string} signedBy - Public key fingerprint
   * @param {string|number} hashingSchemeVersion - From prepare response
   * @param {object} cancelMeta - { orderContractId, orderId, tradingPair, orderDetails }
   * @returns {Object} Cancellation result
   */
  async executeOrderCancel(preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, cancelMeta = {}) {
    this._assertExecutorOauthConfigured();
    const interactiveLedgerToken = await tokenProvider.getExecutorToken();
    
    try {
      console.log(`[OrderService] EXECUTE order cancel for ${partyId.substring(0, 30)}...`);
      
      const partySignatures = {
        signatures: [
          {
            party: partyId,
            signatures: [{
              format: 'SIGNATURE_FORMAT_RAW',
              signature: signatureBase64,
              signedBy: signedBy,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519'
            }]
          }
        ]
      };

      if (partySignatures.signatures[0]?.party !== partyId) {
        throw new ValidationError('Cancel execute: signature entry must be for the requesting user party only.');
      }
      
      const result = await cantonService.executeInteractiveSubmission({
        preparedTransaction,
        partySignatures,
        hashingSchemeVersion,
      }, interactiveLedgerToken);
      
      console.log(`[OrderService] ✅ Order cancelled via interactive submission: ${cancelMeta.orderContractId?.substring(0, 20)}...`);
      
      // Release balance reservation
      if (cancelMeta.orderId) {
        await releaseReservation(cancelMeta.orderId);
      }
      
      // Remove from tracking
      const readModel = getReadModelService();
      if (readModel) {
        readModel.removeOrder(cancelMeta.orderContractId);
      }
      
      // Unregister from global registry
      if (cancelMeta.orderContractId) {
        _globalOpenOrders.delete(cancelMeta.orderContractId);
      }
      
      // Broadcast via WebSocket to both orderbook and user-specific channels
      if (global.broadcastWebSocket) {
        const ts = new Date().toISOString();
        if (cancelMeta.tradingPair) {
          global.broadcastWebSocket(`orderbook:${cancelMeta.tradingPair}`, {
            type: 'ORDER_CANCELLED',
            contractId: cancelMeta.orderContractId,
            orderId: cancelMeta.orderId,
            tradingPair: cancelMeta.tradingPair,
            timestamp: ts,
          });
        }
        if (partyId) {
          global.broadcastWebSocket(`orders:${partyId}`, {
            type: 'ORDER_ARCHIVED',
            contractId: cancelMeta.orderContractId,
            orderId: cancelMeta.orderId,
            timestamp: ts,
          });
        }
      }
      
      return {
        success: true,
        usedInteractiveSubmission: true,
        cancelled: true,
        orderContractId: cancelMeta.orderContractId,
        orderId: cancelMeta.orderId,
        tradingPair: cancelMeta.tradingPair,
      };
      
    } catch (error) {
      console.error('[OrderService] Failed to execute order cancel:', error.message);
      throw error;
    }
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
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: templateIdsToQuery,
        pageSize: limit
      }, token);

      const { getMatchingEngine } = require('./matching-engine');
      const engine = getMatchingEngine();

      const orders = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          const templateId = c.templateId;
          if (!templateId?.includes(':Order:Order')) {
            return false;
          }
          const payload = c.payload || c.createArgument || {};
          if (payload.owner !== partyId) return false;
          
          let effectiveStatus = payload.status;
          // If Canton thinks it's OPEN, but our matching engine quarantined it
          // (because the underlying Splice allocation expired or was missing),
          // treat it as FAILED/EXPIRED so it drops out of the Active Orders UI.
          if (effectiveStatus === 'OPEN' && engine.invalidSettlementContracts.has(c.contractId)) {
            effectiveStatus = 'EXPIRED';
          }
          
          return status === 'ALL' || effectiveStatus === status;
        })
        .map(c => {
          const payload = c.payload || c.createArgument || {};
          const contractId = c.contractId;
          
          let effectiveStatus = payload.status;
          if (effectiveStatus === 'OPEN' && engine.invalidSettlementContracts.has(contractId)) {
            effectiveStatus = 'EXPIRED';
          }
          
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
            status: effectiveStatus,
            timestamp: payload.timestamp,
            allocationCid: payload.allocationCid || null
          };
        });

      console.log(`[OrderService] Found ${orders.length} orders from Canton for ${partyId.substring(0, 30)}...`);
      
      // Register OPEN orders in the global registry so the OrderBookService can see them
      // (handles orders placed through other backend instances where operator is not a stakeholder)
      registerOpenOrders(orders.filter(o => o.status === 'OPEN'));
      
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
          
          const { getMatchingEngine } = require('./matching-engine');
          const engine = getMatchingEngine();
          
          const orders = (Array.isArray(contracts) ? contracts : [])
            .filter(c => {
              const payload = c.payload || c.createArgument || {};
              if (payload.owner !== partyId) return false;
              let effectiveStatus = payload.status;
              if (effectiveStatus === 'OPEN' && engine.invalidSettlementContracts.has(c.contractId)) {
                effectiveStatus = 'EXPIRED';
              }
              return status === 'ALL' || effectiveStatus === status;
            })
            .map(c => {
              const payload = c.payload || c.createArgument || {};
              let effectiveStatus = payload.status;
              if (effectiveStatus === 'OPEN' && engine.invalidSettlementContracts.has(c.contractId)) {
                effectiveStatus = 'EXPIRED';
              }
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
                status: effectiveStatus,
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

      const { getMatchingEngine } = require('./matching-engine');
      const engine = getMatchingEngine();

      // Filter by trading pair and OPEN status (exclude PENDING_TRIGGER stop-loss orders)
      const orders = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          const payload = c.payload || c.createArgument || {};
          let effectiveStatus = payload.status;
          if (effectiveStatus === 'OPEN' && engine.invalidSettlementContracts.has(c.contractId)) {
            effectiveStatus = 'EXPIRED';
          }
          return payload.tradingPair === tradingPair && effectiveStatus === 'OPEN';
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
            status: 'OPEN',
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
   * Get order by contract ID.
   * Uses streaming read model first (avoids Canton lookup which may 404 on some deployments).
   */
  async getOrder(orderContractId) {
    if (!orderContractId) {
      throw new ValidationError('Order contract ID is required');
    }

    try {
      const readModel = getReadModelService();
      const fromCache = await readModel.getOrderByContractId(orderContractId);
      if (fromCache) {
        return {
          contractId: fromCache.contractId,
          orderId: fromCache.orderId,
          owner: fromCache.owner,
          tradingPair: fromCache.tradingPair,
          orderType: fromCache.orderType,
          orderMode: fromCache.orderMode || 'LIMIT',
          price: fromCache.price?.Some ?? fromCache.price,
          quantity: fromCache.quantity,
          filled: fromCache.filled || '0',
          status: fromCache.status,
          timestamp: fromCache.timestamp,
          allocationCid: fromCache.allocationCid || null
        };
      }

      const token = await tokenProvider.getServiceToken();
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
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
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
module.exports.setAllocationContractIdForOrder = setAllocationContractIdForOrder;
module.exports.getAllocationTypeForOrder = getAllocationTypeForOrder;
module.exports.getGlobalOpenOrders = getGlobalOpenOrders;
