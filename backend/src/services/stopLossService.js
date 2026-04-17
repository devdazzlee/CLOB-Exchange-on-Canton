/**
 * Stop-Loss Service — Allocation-Based Settlement
 * PostgreSQL via Prisma (Neon) — ALL reads/writes go directly to DB.
 * No in-memory cache.
 * 
 * Stop-Loss Flow:
 * 1. User places STOP_LOSS order → funds locked in Allocation, status = PENDING_TRIGGER
 * 2. After every trade, matching engine calls checkTriggers(pair, lastTradePrice)
 * 3. If price crosses stop-loss threshold:
 *    a. Update order status: PENDING_TRIGGER → OPEN
 *    b. Convert to market order (no price limit)
 *    c. Add to active order book
 *    d. Trigger immediate matching
 * 4. Cancellation releases the Allocation (funds returned)
 */

const EventEmitter = require('events');
const Decimal = require('decimal.js');
const cantonService = require('./cantonService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');
const { getDb } = require('./db');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

class StopLossService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this._onTradeCreated = null;
    // Prevents concurrent duplicate TriggerStopLoss submissions for the same order
    this._inFlightTriggers = new Set();
  }

  /**
   * Start the stop-loss monitoring service.
   *
   * Pure event-driven — NO setInterval, NO polling, NO DB cost when idle.
   *
   *   Trigger 1 → StreamingReadModel emits 'tradeCreated' on every Canton
   *               trade event received via WebSocket → checkTriggers() fires.
   *   Trigger 2 → Matching engine calls checkTriggers() directly after every
   *               settlement (already wired in executeMatch).
   *   Trigger 3 → On reconnect, app.js listens to streaming.on('ready') and
   *               calls syncFromReadModel() to reload any pending stop-losses.
   *
   * setInterval removed entirely — it was polling DB every N seconds for no
   * benefit over the event-driven paths above, and caused error spam on any
   * transient DB connection drop.
   */
  async start() {
    if (this.isRunning) {
      console.log('[StopLoss] Service already running');
      return;
    }

    this.isRunning = true;

    try {
      const { getStreamingReadModel } = require('./streamingReadModel');
      const streaming = getStreamingReadModel();
      if (streaming) {
        this._onTradeCreated = (trade) => {
          if (!trade?.tradingPair || !trade?.price) return;
          this.checkTriggers(trade.tradingPair, trade.price).catch(() => {});
        };
        streaming.on('tradeCreated', this._onTradeCreated);

        // Sync any PENDING_TRIGGER orders that are on-ledger but missing from DB.
        // This covers the case where the backend restarted and lost in-memory state,
        // or where a registration upsert was dropped due to a transient DB error.
        if (streaming.isReady()) {
          this._syncFromStreaming(streaming).catch(() => {});
          // Immediately check triggers using last known trade prices from streaming model.
          // Handles the case where stop conditions were already met during bootstrap
          // (historical tradeCreated events fired with ready=false, so were skipped).
          this._checkTriggersOnReady(streaming).catch(() => {});
        } else {
          streaming.once('ready', () => {
            this._syncFromStreaming(streaming).catch(() => {});
            this._checkTriggersOnReady(streaming).catch(() => {});
          });
        }

        console.log('[StopLoss] ✅ Started — listening to WebSocket trade events (pure event-driven, no polling)');
      } else {
        console.warn('[StopLoss] ⚠️ Streaming model not available — stop-loss triggers via matching engine only');
      }
    } catch (_) {
      console.warn('[StopLoss] ⚠️ Could not subscribe to streaming trade events');
    }
  }

  /**
   * Sync PENDING_TRIGGER orders from the streaming model into the stopLossOrder DB table.
   * Called on startup so the DB is always consistent with what's on the Canton ledger.
   */
  async _syncFromStreaming(streaming) {
    let synced = 0;
    const db = getDb();

    // First, remove DB entries whose Canton contract no longer exists (stale rows).
    try {
      const dbRows = await db.stopLossOrder.findMany({ where: { status: 'PENDING_TRIGGER' } });
      for (const row of dbRows) {
        const stillOnLedger = row.orderContractId && streaming.orders.has(row.orderContractId);
        if (!stillOnLedger) {
          // Verify by orderId across all streaming orders
          const matchByOrderId = [...streaming.orders.values()].some(o => o.orderId === row.orderId && o.status === 'PENDING_TRIGGER');
          if (!matchByOrderId) {
            await db.stopLossOrder.delete({ where: { orderId: row.orderId } }).catch(() => {});
            console.log(`[StopLoss] 🗑️ Removed stale DB entry: ${row.orderId} (not on ledger)`);
          }
        }
      }
    } catch (_) {}

    for (const [contractId, order] of streaming.orders) {
      if (order.status !== 'PENDING_TRIGGER') continue;
      if (!order.orderId || !order.tradingPair) continue;

      // For stop-loss orders, Canton stores the stop price in the `price` field.
      // `order.stopPrice` (from payload.stopPrice) may be null if Daml doesn't
      // expose it as a separate field — fall back to `order.price` in that case.
      const stopPriceRaw = order.stopPrice || order.price;
      if (!stopPriceRaw) continue;

      try {
        await db.stopLossOrder.upsert({
          where: { orderId: order.orderId },
          create: {
            orderId: order.orderId,
            orderContractId: contractId,
            tradingPair: order.tradingPair,
            orderType: (order.orderType || 'SELL').toUpperCase(),
            stopPrice: stopPriceRaw.toString(),
            quantity: order.quantity?.toString() || '0',
            allocationContractId: order.allocationCid || null,
            partyId: order.owner || null,
            status: 'PENDING_TRIGGER',
          },
          update: {
            orderContractId: contractId,
            status: 'PENDING_TRIGGER',
            stopPrice: stopPriceRaw.toString(),
          },
        });
        console.log(`[StopLoss] 🔄 Synced stop-loss ${order.orderId} (pair=${order.tradingPair}, stopPrice=${stopPriceRaw}, type=${order.orderType})`);
        synced++;
      } catch (e) {
        console.warn(`[StopLoss] ⚠️ Sync failed for ${order.orderId}: ${e.message}`);
      }
    }
    console.log(`[StopLoss] 🔄 Sync complete — ${synced} PENDING_TRIGGER order(s) synced from ledger`);
  }

  /**
   * After ACS bootstrap completes (streaming model is ready), check all pending
   * stop-loss orders against the last known trade price for each pair.
   *
   * This is necessary because during ACS bootstrap the 'tradeCreated' events
   * for historical Trade contracts fire with ready=false, causing checkTriggers
   * to skip the streaming path. Once bootstrap is done this method fires the
   * check against the most recent trade price available in the streaming model.
   */
  async _checkTriggersOnReady(streaming) {
    // Collect unique trading pairs that have PENDING_TRIGGER orders
    const pendingPairs = new Map(); // pair → latest trade price
    for (const [, order] of streaming.orders) {
      if (order.status !== 'PENDING_TRIGGER') continue;
      if (!order.tradingPair) continue;
      if (!pendingPairs.has(order.tradingPair)) {
        pendingPairs.set(order.tradingPair, null);
      }
    }

    if (pendingPairs.size === 0) {
      console.log('[StopLoss] _checkTriggersOnReady: no PENDING_TRIGGER orders — skipping');
      return;
    }

    // For each pair, find the most recent trade price from streaming model
    for (const [pair] of pendingPairs) {
      const trades = streaming.getTradesForPair(pair);
      if (trades.length > 0) {
        const lastPrice = trades[0].price; // sorted desc by timestamp
        if (lastPrice) {
          pendingPairs.set(pair, lastPrice);
        }
      }
    }

    console.log(`[StopLoss] 🔔 _checkTriggersOnReady: checking ${pendingPairs.size} pair(s) with PENDING_TRIGGER orders`);
    for (const [pair, lastPrice] of pendingPairs) {
      if (!lastPrice) {
        console.log(`[StopLoss]   ${pair}: no recent trade price — skipping`);
        continue;
      }
      console.log(`[StopLoss]   ${pair}: lastTradePrice=${lastPrice} — running checkTriggers`);
      await this.checkTriggers(pair, lastPrice).catch(err =>
        console.warn(`[StopLoss]   ${pair}: checkTriggers error: ${err.message}`)
      );
    }
  }

  /**
   * Stop the stop-loss monitoring service.
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;

    try {
      const { getStreamingReadModel } = require('./streamingReadModel');
      const streaming = getStreamingReadModel();
      if (streaming && this._onTradeCreated) {
        streaming.off('tradeCreated', this._onTradeCreated);
        this._onTradeCreated = null;
      }
    } catch (_) {}

    console.log('[StopLoss] ✅ Stopped');
  }

  /**
   * Register a stop-loss order for monitoring.
   */
  async registerStopLoss(cfg) {
    const {
      orderContractId,
      orderId,
      tradingPair,
      orderType,
      stopPrice,
      partyId,
      quantity,
      allocationContractId,
    } = cfg;

    if (!orderId || !tradingPair || !stopPrice) {
      throw new Error('Missing required stop-loss configuration: orderId, tradingPair, stopPrice');
    }

    console.log(`[StopLoss] 📋 Registering stop-loss:`);
    console.log(`  Order: ${orderId} (${orderContractId?.substring(0, 20) || 'N/A'}...)`);
    console.log(`  Pair: ${tradingPair}, Side: ${orderType}`);
    console.log(`  Trigger Price: ${stopPrice}`);
    console.log(`  Allocation: ${allocationContractId?.substring(0, 20) || 'none'}...`);

    const db = getDb();
    await db.stopLossOrder.upsert({
      where: { orderId },
      create: {
        orderId,
        orderContractId: orderContractId || null,
        tradingPair,
        orderType: orderType.toUpperCase(),
        stopPrice: stopPrice.toString(),
        quantity: quantity?.toString() || '0',
        allocationContractId: allocationContractId || null,
        partyId: partyId || null,
        status: 'PENDING_TRIGGER',
      },
      update: {
        orderContractId: orderContractId || null,
        tradingPair,
        orderType: orderType.toUpperCase(),
        stopPrice: stopPrice.toString(),
        quantity: quantity?.toString() || '0',
        allocationContractId: allocationContractId || null,
        status: 'PENDING_TRIGGER',
      },
    });

    this.emit('stopLossRegistered', { orderId, tradingPair, stopPrice: stopPrice.toString() });
  }

  /**
   * Unregister a stop-loss order (on cancel or trigger).
   */
  async unregisterStopLoss(orderContractIdOrOrderId) {
    const db = getDb();

    // Try to find by orderId first, then by orderContractId
    let row = await db.stopLossOrder.findUnique({ where: { orderId: orderContractIdOrOrderId } });
    if (!row) {
      row = await db.stopLossOrder.findFirst({ where: { orderContractId: orderContractIdOrOrderId } });
    }
    if (!row) return;

    console.log(`[StopLoss] Unregistering stop-loss: ${row.orderId}`);

    await db.stopLossOrder.delete({ where: { orderId: row.orderId } }).catch(err =>
      console.warn('[StopLoss] DB unregister failed:', err.message)
    );

    this.emit('stopLossUnregistered', { orderId: row.orderId });
  }

  /**
   * PRIMARY TRIGGER: Called by the matching engine after every successful trade.
   *
   * Source of truth priority:
   *   1. StreamingReadModel (in-memory, always in sync with Canton ledger via WebSocket)
   *   2. PostgreSQL DB (fallback only — used when streaming model not ready)
   *
   * This matches professional exchange design: active order state lives in memory,
   * not in a relational DB. The DB is for trade history / audit only.
   */
  async checkTriggers(tradingPair, lastTradePrice) {
    // ── PRIMARY: streaming model (in-memory, zero DB cost, always in sync) ──
    let pendingOrders = [];
    try {
      const { getStreamingReadModel } = require('./streamingReadModel');
      const streaming = getStreamingReadModel();
      const ready = streaming?.isReady();
      // Always log streaming state for diagnosis
      const totalOrders = streaming?.orders?.size ?? 'N/A';
      const allPendingAll = streaming?.orders ? [...streaming.orders.values()].filter(o => o.status === 'PENDING_TRIGGER') : [];
      console.log(`[StopLoss] 🔎 checkTriggers(${tradingPair}, ${lastTradePrice}) ready=${ready} totalOrders=${totalOrders} pendingInStreaming=${allPendingAll.length}`);
      if (allPendingAll.length > 0) {
        console.log(`[StopLoss] 🔍 PENDING_TRIGGER orders: ${allPendingAll.map(o => `${o.orderId}(pair=${o.tradingPair},stop=${o.stopPrice||o.price},type=${o.orderType})`).join(', ')}`);
      }
      if (ready) {
        for (const [contractId, order] of streaming.orders) {
          if (order.tradingPair !== tradingPair) continue;
          if (order.status !== 'PENDING_TRIGGER') continue;
          // stopPrice is stored in order.stopPrice OR order.price (Canton stores it in price field)
          const stopPriceRaw = order.stopPrice || order.price;
          if (!stopPriceRaw || !order.orderId || !order.orderType) continue;
          pendingOrders.push({
            orderId:             order.orderId,
            orderContractId:     contractId,
            tradingPair:         order.tradingPair,
            orderType:           order.orderType,
            stopPrice:           stopPriceRaw.toString(),
            quantity:            order.quantity || '0',
            allocationContractId: order.allocationCid || null,
            partyId:             order.owner || null,
          });
        }
      }
    } catch (diagErr) {
      console.error(`[StopLoss] ❌ checkTriggers diagnostic error: ${diagErr.message}`);
    }

    // ── FALLBACK: DB (only if streaming not ready) ──
    if (pendingOrders.length === 0) {
      try {
        const db = getDb();
        const rows = await db.stopLossOrder.findMany({
          where: { tradingPair, status: 'PENDING_TRIGGER' },
        });
        pendingOrders = rows;
      } catch (_) {}
    }

    console.log(`[StopLoss] checkTriggers(${tradingPair}, ${lastTradePrice}) → ${pendingOrders.length} pending order(s)`);
    if (pendingOrders.length === 0) return;

    const price = new Decimal(lastTradePrice);
    const triggered = [];

    for (const entry of pendingOrders) {
      const stopPrice = new Decimal(entry.stopPrice);
      const shouldTrigger =
        (entry.orderType === 'SELL' && price.lte(stopPrice)) ||
        (entry.orderType === 'BUY'  && price.gte(stopPrice));

      if (shouldTrigger) {
        triggered.push({ orderId: entry.orderId, entry, triggerPrice: price.toString() });
      }
    }

    if (triggered.length > 0) {
      console.log(`[StopLoss] 🎯 ${triggered.length} stop-loss order(s) triggered at ${lastTradePrice} for ${tradingPair}`);
    }

    for (const { orderId, entry, triggerPrice } of triggered) {
      // Guard: skip if another concurrent checkTriggers call is already triggering this order
      if (this._inFlightTriggers.has(orderId)) {
        console.log(`[StopLoss] ⏭️ ${orderId} trigger already in-flight — skipping duplicate`);
        continue;
      }
      this._inFlightTriggers.add(orderId);
      try {
        await this.triggerOrder(orderId, entry, triggerPrice);
      } catch (err) {
        console.error(`[StopLoss] ❌ Failed to trigger stop-loss ${orderId}: ${err.message}`);
        this.emit('stopLossError', { orderId, error: err });
      } finally {
        this._inFlightTriggers.delete(orderId);
      }
    }
  }

  /**
   * Trigger a stop-loss order: convert to market order and add to order book.
   */
  async triggerOrder(orderId, entry, triggerPrice) {
    console.log(`[StopLoss] 🎯 Triggering stop-loss: ${orderId} at ${triggerPrice}`);
    console.log(`  Side: ${entry.orderType}, Stop Price: ${entry.stopPrice.toString()}`);

    let token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    // Resolve the real Canton contract ID. When a stop-loss is registered immediately
    // after interactive order placement, the contractId may be a placeholder ending in
    // "-pending" because the Canton event hadn't arrived yet. Look it up from the ledger.
    let resolvedContractId = entry.orderContractId;
    if (!resolvedContractId || resolvedContractId.endsWith('-pending') || resolvedContractId === orderId) {
      console.log(`[StopLoss] 🔍 Pending contractId detected — querying Canton for Order ${orderId}...`);
      try {
        const contracts = await cantonService.queryActiveContracts(
          { party: operatorPartyId, templateIds: [`${packageId}:Order:Order`] },
          token
        );
        const list = Array.isArray(contracts) ? contracts : (contracts?.activeContracts || contracts?.contracts || []);
        for (const c of list) {
          const ev = c.createdEvent || c;
          const p = ev?.createArguments || ev?.createArgument || ev?.payload || {};
          if (p.orderId === orderId) {
            resolvedContractId = c.contractId || ev?.contractId;
            console.log(`[StopLoss] ✅ Resolved real contractId: ${resolvedContractId?.substring(0, 24)}...`);
            // Persist the resolved ID so we don't need to look it up again
            const db = getDb();
            await db.stopLossOrder.update({
              where: { orderId },
              data: { orderContractId: resolvedContractId },
            }).catch(() => {});
            break;
          }
        }
      } catch (lookupErr) {
        console.warn(`[StopLoss] ⚠️ Contract lookup failed: ${lookupErr.message}`);
      }
      if (!resolvedContractId || resolvedContractId.endsWith('-pending')) {
        throw new Error(`Cannot trigger stop-loss ${orderId}: Order contract not found on ledger`);
      }
    }

    // Attempt TriggerStopLoss with one retry for LOCAL_VERDICT_LOCKED_CONTRACTS.
    // Locked contract means another submission is racing — wait briefly and retry once.
    let triggerAttempt = 0;
    while (true) {
      triggerAttempt++;
      try {
        await cantonService.exerciseChoice({
          token,
          actAsParty: [operatorPartyId],
          templateId: `${packageId}:Order:Order`,
          contractId: resolvedContractId,
          choice: 'TriggerStopLoss',
          choiceArgument: {
            triggeredAt: new Date().toISOString(),
            triggerPrice: triggerPrice.toString(),
          },
          readAs: [operatorPartyId, entry.partyId],
        });
        console.log(`[StopLoss] ✅ Order ${orderId} status updated to OPEN on Canton`);
        break; // success
      } catch (choiceErr) {
        const isLocked = choiceErr.message?.includes('LOCAL_VERDICT_LOCKED_CONTRACTS') ||
          choiceErr.message?.includes('LOCKED_CONTRACTS');
        if (isLocked && triggerAttempt === 1) {
          // Contract is locked by a concurrent submission. Wait 2s and retry once —
          // the lock will be released when the first submission completes or aborts.
          console.warn(`[StopLoss] ⚠️ Contract locked for ${orderId} — waiting 2s then retrying`);
          await new Promise(r => setTimeout(r, 2000));
          // Re-fetch a fresh token before retry
          token = await tokenProvider.getServiceToken();
          continue;
        }
        console.warn(`[StopLoss] ⚠️ TriggerStopLoss choice failed (attempt ${triggerAttempt}): ${choiceErr.message}`);
        throw new Error(`TriggerStopLoss failed for ${orderId}: ${choiceErr.message}`);
      }
    }

    // Update DB (upsert — row may not exist if order came from StreamingReadModel without prior DB registration)
    const db = getDb();
    await db.stopLossOrder.upsert({
      where: { orderId },
      create: {
        orderId,
        orderContractId: entry?.orderContractId || null,
        tradingPair: entry?.tradingPair || 'UNKNOWN',
        orderType: (entry?.orderType || 'SELL').toUpperCase(),
        stopPrice: entry?.stopPrice?.toString() || '0',
        quantity: entry?.quantity?.toString() || '0',
        allocationContractId: entry?.allocationContractId || null,
        partyId: entry?.partyId || null,
        status: 'TRIGGERED',
        triggeredAt: new Date(),
        triggerPrice,
      },
      update: {
        status: 'TRIGGERED',
        triggeredAt: new Date(),
        triggerPrice,
      },
    }).catch(err => console.warn('[StopLoss] DB trigger update failed:', err.message));

    try {
      const { getReadModelService } = require('./readModelService');
      const readModel = getReadModelService();
      if (readModel) {
        const existingOrder = readModel.getOrderByContractId(entry.orderContractId);
        if (existingOrder) {
          existingOrder.status = 'OPEN';
          existingOrder.orderMode = 'MARKET';
          existingOrder.price = null;
          existingOrder.triggeredAt = new Date().toISOString();
          console.log(`[StopLoss] ✅ Order updated in ReadModel as MARKET order`);
        }
      }
    } catch (rmErr) {
      console.warn(`[StopLoss] ⚠️ ReadModel update failed: ${rmErr.message}`);
    }

    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`orderbook:${entry.tradingPair}`, {
        type: 'STOP_LOSS_TRIGGERED',
        orderId,
        orderContractId: entry.orderContractId,
        orderType: entry.orderType,
        stopPrice: entry.stopPrice.toString(),
        triggerPrice,
        triggeredAt: new Date().toISOString(),
        tradingPair: entry.tradingPair,
      });
    }

    try {
      const { getMatchingEngine } = require('./matching-engine');
      const matchingEngine = getMatchingEngine();
      if (matchingEngine) {
        console.log(`[StopLoss] ⚡ Triggering immediate matching for ${entry.tradingPair}`);
        const result = await matchingEngine.triggerMatchingCycle(entry.tradingPair);
        console.log(`[StopLoss] ⚡ Matching result: ${JSON.stringify(result)}`);
      }
    } catch (matchErr) {
      console.warn(`[StopLoss] ⚠️ Matching trigger failed: ${matchErr.message}`);
    }

    await this.unregisterStopLoss(orderId);

    this.emit('stopLossTriggered', {
      orderId,
      orderContractId: entry.orderContractId,
      tradingPair: entry.tradingPair,
      orderType: entry.orderType,
      stopPrice: entry.stopPrice.toString(),
      triggerPrice,
      triggeredAt: new Date().toISOString(),
    });

    console.log(`[StopLoss] ✅ Stop-loss ${orderId} triggered and converted to market order`);
  }


  /**
   * Get pending stop-loss orders for a party.
   * Primary: StreamingReadModel (in-memory, always in sync with Canton).
   * Fallback: PostgreSQL DB.
   */
  async getPendingStopOrders(partyId = null, tradingPair = null) {
    try {
      const { getStreamingReadModel } = require('./streamingReadModel');
      const streaming = getStreamingReadModel();
      if (streaming?.isReady()) {
        const results = [];
        for (const [contractId, order] of streaming.orders) {
          if (order.status !== 'PENDING_TRIGGER') continue;
          if (partyId && order.owner !== partyId) continue;
          if (tradingPair && order.tradingPair !== tradingPair) continue;
          const stopPriceRaw = order.stopPrice || order.price;
          results.push({
            orderId:             order.orderId,
            orderContractId:     contractId,
            tradingPair:         order.tradingPair,
            orderType:           order.orderType,
            stopPrice:           stopPriceRaw?.toString() || null,
            quantity:            order.quantity || '0',
            status:              'PENDING_TRIGGER',
            registeredAt:        order.timestamp || null,
            allocationContractId: order.allocationCid || null,
          });
        }
        return results;
      }
    } catch (_) {}

    // Fallback: DB
    const db = getDb();
    const where = { status: 'PENDING_TRIGGER' };
    if (partyId) where.partyId = partyId;
    if (tradingPair) where.tradingPair = tradingPair;
    const rows = await db.stopLossOrder.findMany({ where });
    return rows.map(entry => ({
      orderId:             entry.orderId,
      orderContractId:     entry.orderContractId,
      tradingPair:         entry.tradingPair,
      orderType:           entry.orderType,
      stopPrice:           entry.stopPrice,
      quantity:            entry.quantity,
      status:              entry.status,
      registeredAt:        entry.registeredAt?.toISOString(),
      allocationContractId: entry.allocationContractId,
    }));
  }

  /**
   * Legacy API: getActiveStopLosses (backward compat)
   */
  async getActiveStopLosses(partyId) {
    const pending = await this.getPendingStopOrders(partyId);
    return pending.map(entry => ({
      orderContractId: entry.orderContractId,
      tradingPair: entry.tradingPair,
      orderType: entry.orderType,
      stopLossPrice: entry.stopPrice,
      originalPrice: null,
      registeredAt: entry.registeredAt,
    }));
  }

  /**
   * Legacy API: registerStopLoss with old field names (backward compat)
   */
  async registerStopLossLegacy(cfg) {
    return this.registerStopLoss({
      orderContractId: cfg.orderContractId,
      orderId: cfg.orderContractId,
      tradingPair: cfg.tradingPair,
      orderType: cfg.orderType,
      stopPrice: cfg.stopLossPrice,
      partyId: cfg.partyId,
      quantity: null,
      allocationContractId: null,
    });
  }

}

// Singleton instance
let instance = null;

function getStopLossService() {
  if (!instance) {
    instance = new StopLossService();
  }
  return instance;
}

module.exports = {
  StopLossService,
  getStopLossService,
};
