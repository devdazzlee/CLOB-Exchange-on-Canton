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
    this.checkInterval = null;
    this.checkIntervalMs = 5000;
  }

  /**
   * Start the stop-loss monitoring service.
   */
  async start() {
    if (this.isRunning) {
      console.log('[StopLoss] Service already running');
      return;
    }

    console.log('[StopLoss] Starting stop-loss monitoring service...');
    this.isRunning = true;

    this.checkInterval = setInterval(() => {
      this._periodicCheck().catch(err => {
        console.error('[StopLoss] Periodic check error:', err.message);
      });
    }, this.checkIntervalMs);

    console.log('[StopLoss] ✅ Service started');
  }

  /**
   * Stop the stop-loss monitoring service
   */
  stop() {
    if (!this.isRunning) return;

    console.log('[StopLoss] Stopping stop-loss monitoring service...');
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log('[StopLoss] ✅ Service stopped');
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
   */
  async checkTriggers(tradingPair, lastTradePrice) {
    const db = getDb();
    const pendingOrders = await db.stopLossOrder.findMany({
      where: { tradingPair, status: 'PENDING_TRIGGER' },
    });

    if (pendingOrders.length === 0) return;

    const price = new Decimal(lastTradePrice);
    const triggered = [];

    for (const entry of pendingOrders) {
      let shouldTrigger = false;
      const stopPrice = new Decimal(entry.stopPrice);

      if (entry.orderType === 'SELL' && price.lte(stopPrice)) {
        shouldTrigger = true;
      }
      if (entry.orderType === 'BUY' && price.gte(stopPrice)) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        triggered.push({ orderId: entry.orderId, entry, triggerPrice: price.toString() });
      }
    }

    if (triggered.length > 0) {
      console.log(`[StopLoss] 🎯 ${triggered.length} stop-loss order(s) triggered at ${lastTradePrice} for ${tradingPair}`);
    }

    for (const { orderId, entry, triggerPrice } of triggered) {
      try {
        await this.triggerOrder(orderId, entry, triggerPrice);
      } catch (err) {
        console.error(`[StopLoss] ❌ Failed to trigger stop-loss ${orderId}: ${err.message}`);
        this.emit('stopLossError', { orderId, error: err });
      }
    }
  }

  /**
   * Trigger a stop-loss order: convert to market order and add to order book.
   */
  async triggerOrder(orderId, entry, triggerPrice) {
    console.log(`[StopLoss] 🎯 Triggering stop-loss: ${orderId} at ${triggerPrice}`);
    console.log(`  Side: ${entry.orderType}, Stop Price: ${entry.stopPrice.toString()}`);

    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    try {
      await cantonService.exerciseChoice({
        token,
        actAsParty: [operatorPartyId],
        templateId: `${packageId}:Order:Order`,
        contractId: entry.orderContractId,
        choice: 'TriggerStopLoss',
        choiceArgument: {
          triggeredAt: new Date().toISOString(),
          triggerPrice: triggerPrice.toString(),
        },
        readAs: [operatorPartyId, entry.partyId],
      });
      console.log(`[StopLoss] ✅ Order ${orderId} status updated to OPEN on Canton`);
    } catch (choiceErr) {
      console.warn(`[StopLoss] ⚠️ TriggerStopLoss choice failed: ${choiceErr.message}`);
    }

    // Update DB
    const db = getDb();
    await db.stopLossOrder.update({
      where: { orderId },
      data: {
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
   * Backup periodic check
   */
  async _periodicCheck() {
    const db = getDb();
    const distinctPairs = await db.stopLossOrder.findMany({
      where: { status: 'PENDING_TRIGGER' },
      select: { tradingPair: true },
      distinct: ['tradingPair'],
    });

    if (distinctPairs.length === 0) return;

    for (const { tradingPair } of distinctPairs) {
      try {
        const price = await this._getMarketPrice(tradingPair);
        if (price && price > 0) {
          await this.checkTriggers(tradingPair, price);
        }
      } catch (err) {
        // Suppress
      }
    }
  }

  /**
   * Get current market price for a trading pair.
   */
  async _getMarketPrice(tradingPair) {
    try {
      const { getStreamingReadModel } = require('./streamingReadModel');
      const streaming = getStreamingReadModel();
      if (streaming?.isReady()) {
        const book = streaming.getOrderBook(tradingPair);
        if (book.buyOrders?.length > 0 && book.sellOrders?.length > 0) {
          const bestBid = parseFloat(book.buyOrders[0]?.price || 0);
          const bestAsk = parseFloat(book.sellOrders[0]?.price || 0);
          if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
          if (bestBid > 0) return bestBid;
          if (bestAsk > 0) return bestAsk;
        }

        const trades = streaming.getTradesForPair(tradingPair, 1);
        if (trades.length > 0 && trades[0].price) {
          return parseFloat(trades[0].price);
        }
      }
    } catch (err) {
      // Suppress
    }

    try {
      const { getOrderBookService } = require('./orderBookService');
      const orderBookService = getOrderBookService();
      const orderBook = await orderBookService.getOrderBook(tradingPair);

      if (orderBook.buyOrders?.length > 0 && orderBook.sellOrders?.length > 0) {
        const bestBid = parseFloat(orderBook.buyOrders[0]?.price || 0);
        const bestAsk = parseFloat(orderBook.sellOrders[0]?.price || 0);
        if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
        if (bestBid > 0) return bestBid;
        if (bestAsk > 0) return bestAsk;
      }

      if (orderBook.lastPrice) return parseFloat(orderBook.lastPrice);
    } catch (err) {
      // Suppress
    }

    return null;
  }

  /**
   * Get pending stop-loss orders for a party.
   */
  async getPendingStopOrders(partyId = null, tradingPair = null) {
    const db = getDb();
    const where = { status: 'PENDING_TRIGGER' };
    if (partyId) where.partyId = partyId;
    if (tradingPair) where.tradingPair = tradingPair;

    const rows = await db.stopLossOrder.findMany({ where });
    return rows.map(entry => ({
      orderId: entry.orderId,
      orderContractId: entry.orderContractId,
      tradingPair: entry.tradingPair,
      orderType: entry.orderType,
      stopPrice: entry.stopPrice,
      quantity: entry.quantity,
      status: entry.status,
      registeredAt: entry.registeredAt?.toISOString(),
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

  /**
   * Legacy API: checkStopLosses (backward compat for periodic check)
   */
  async checkStopLosses() {
    return this._periodicCheck();
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
