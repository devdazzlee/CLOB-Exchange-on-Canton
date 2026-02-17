/**
 * Stop-Loss Service — Allocation-Based Settlement
 * 
 * Monitors price movements and triggers stop-loss orders when thresholds are breached.
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
 * 
 * Stop-Loss Rules:
 * - SELL stop-loss: triggers when price DROPS to or below stopPrice
 * - BUY stop-loss: triggers when price RISES to or above stopPrice
 * - Stop-loss orders are INVISIBLE to the order book until triggered
 * - Funds are locked in Allocation at placement (not at trigger)
 * 
 * @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-v1/
 */

const EventEmitter = require('events');
const Decimal = require('decimal.js');
const cantonService = require('./cantonService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

// Configure decimal precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

class StopLossService extends EventEmitter {
  constructor() {
    super();
    // Map<orderId, stopLossConfig>
    this.pendingStopOrders = new Map();
    // Map<tradingPair, Set<orderId>> — for fast pair-based lookups
    this.pairIndex = new Map();
    this.isRunning = false;
    this.checkInterval = null;
    this.checkIntervalMs = 5000; // Check every 5 seconds (backup poll)
  }

  /**
   * Start the stop-loss monitoring service.
   * This runs a backup poll; primary trigger is via checkTriggers() after trades.
   */
  async start() {
    if (this.isRunning) {
      console.log('[StopLoss] Service already running');
      return;
    }

    console.log('[StopLoss] Starting stop-loss monitoring service...');
    this.isRunning = true;

    // Backup periodic check (primary trigger is from matching engine after each trade)
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
   * Called by OrderService when a STOP_LOSS order is placed.
   * 
   * @param {Object} cfg
   * @param {string} cfg.orderContractId - Canton contract ID of the order
   * @param {string} cfg.orderId - Unique order ID
   * @param {string} cfg.tradingPair - e.g., "CC/CBTC"
   * @param {string} cfg.orderType - "BUY" or "SELL"
   * @param {string|number} cfg.stopPrice - Trigger price
   * @param {string} cfg.partyId - Owner party
   * @param {string} cfg.quantity - Order quantity
   * @param {string|null} cfg.allocationContractId - Allocation contract ID
   */
  registerStopLoss(cfg) {
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

    const entry = {
      orderContractId,
      orderId,
      tradingPair,
      orderType: orderType.toUpperCase(),
      stopPrice: new Decimal(stopPrice),
      partyId,
      quantity: quantity?.toString() || '0',
      allocationContractId: allocationContractId || null,
      registeredAt: new Date().toISOString(),
      status: 'PENDING_TRIGGER',
    };

    this.pendingStopOrders.set(orderId, entry);

    // Index by trading pair
    if (!this.pairIndex.has(tradingPair)) {
      this.pairIndex.set(tradingPair, new Set());
    }
    this.pairIndex.get(tradingPair).add(orderId);

    this.emit('stopLossRegistered', { orderId, tradingPair, stopPrice: stopPrice.toString() });
  }

  /**
   * Unregister a stop-loss order (on cancel or trigger).
   */
  unregisterStopLoss(orderContractIdOrOrderId) {
    // Find by orderId first, then by contractId
    let orderId = null;
    if (this.pendingStopOrders.has(orderContractIdOrOrderId)) {
      orderId = orderContractIdOrOrderId;
    } else {
      for (const [oid, entry] of this.pendingStopOrders) {
        if (entry.orderContractId === orderContractIdOrOrderId) {
          orderId = oid;
          break;
        }
      }
    }

    if (!orderId) return;

    const entry = this.pendingStopOrders.get(orderId);
    if (!entry) return;

    console.log(`[StopLoss] Unregistering stop-loss: ${orderId}`);

    // Remove from pair index
    const pairSet = this.pairIndex.get(entry.tradingPair);
    if (pairSet) {
      pairSet.delete(orderId);
      if (pairSet.size === 0) this.pairIndex.delete(entry.tradingPair);
    }

    this.pendingStopOrders.delete(orderId);
    this.emit('stopLossUnregistered', { orderId });
  }

  /**
   * PRIMARY TRIGGER: Called by the matching engine after every successful trade.
   * Checks if any pending stop-loss orders for this pair should trigger.
   * 
   * @param {string} tradingPair - The pair that just traded
   * @param {number|string} lastTradePrice - The price at which the trade executed
   */
  async checkTriggers(tradingPair, lastTradePrice) {
    const pairOrderIds = this.pairIndex.get(tradingPair);
    if (!pairOrderIds || pairOrderIds.size === 0) return;

    const price = new Decimal(lastTradePrice);
    const triggered = [];

    for (const orderId of pairOrderIds) {
      const entry = this.pendingStopOrders.get(orderId);
      if (!entry || entry.status !== 'PENDING_TRIGGER') continue;

      let shouldTrigger = false;

      // SELL stop-loss: triggers when price drops TO or BELOW stopPrice
      if (entry.orderType === 'SELL' && price.lte(entry.stopPrice)) {
        shouldTrigger = true;
      }

      // BUY stop-loss: triggers when price rises TO or ABOVE stopPrice
      if (entry.orderType === 'BUY' && price.gte(entry.stopPrice)) {
        shouldTrigger = true;
      }

        if (shouldTrigger) {
        triggered.push({ orderId, entry, triggerPrice: price.toString() });
      }
    }

    if (triggered.length > 0) {
      console.log(`[StopLoss] 🎯 ${triggered.length} stop-loss order(s) triggered at ${lastTradePrice} for ${tradingPair}`);
    }

    // Execute triggers sequentially
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
   * 
   * @param {string} orderId - The stop-loss order ID
   * @param {Object} entry - The stop-loss entry
   * @param {string} triggerPrice - The price that triggered it
   */
  async triggerOrder(orderId, entry, triggerPrice) {
    console.log(`[StopLoss] 🎯 Triggering stop-loss: ${orderId} at ${triggerPrice}`);
    console.log(`  Side: ${entry.orderType}, Stop Price: ${entry.stopPrice.toString()}`);

    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    // 1. Update order status on Canton: PENDING_TRIGGER → OPEN
    try {
      // Exercise a choice to update the order status
      // If the DAML template supports TriggerStopLoss, use it
      // Otherwise, use a general UpdateStatus choice
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
      // Try FillOrder with 0 to just change status, or fall through to local handling
      // The order will be treated as a market order in the matching engine
    }

    // 2. Mark as triggered locally
    entry.status = 'TRIGGERED';
    entry.triggeredAt = new Date().toISOString();
    entry.triggerPrice = triggerPrice;

    // 3. Add to ReadModel as an OPEN market order
    try {
      const { getReadModelService } = require('./readModelService');
      const readModel = getReadModelService();
      if (readModel) {
        // Update the existing order in read model
        const existingOrder = readModel.getOrderByContractId(entry.orderContractId);
        if (existingOrder) {
          existingOrder.status = 'OPEN';
          existingOrder.orderMode = 'MARKET'; // Convert to market order
          existingOrder.price = null; // Market order — no price limit
          existingOrder.triggeredAt = entry.triggeredAt;
          console.log(`[StopLoss] ✅ Order updated in ReadModel as MARKET order`);
        }
      }
    } catch (rmErr) {
      console.warn(`[StopLoss] ⚠️ ReadModel update failed: ${rmErr.message}`);
    }

    // 4. Broadcast the trigger via WebSocket
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`orderbook:${entry.tradingPair}`, {
        type: 'STOP_LOSS_TRIGGERED',
        orderId,
        orderContractId: entry.orderContractId,
        orderType: entry.orderType,
        stopPrice: entry.stopPrice.toString(),
        triggerPrice,
        triggeredAt: entry.triggeredAt,
        tradingPair: entry.tradingPair,
      });
    }

    // 5. Trigger immediate matching for this pair
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

    // 6. Unregister — it's been triggered
    this.unregisterStopLoss(orderId);

      this.emit('stopLossTriggered', {
      orderId,
      orderContractId: entry.orderContractId,
      tradingPair: entry.tradingPair,
      orderType: entry.orderType,
      stopPrice: entry.stopPrice.toString(),
      triggerPrice,
      triggeredAt: entry.triggeredAt,
    });

    console.log(`[StopLoss] ✅ Stop-loss ${orderId} triggered and converted to market order`);
  }

  /**
   * Backup periodic check — polls market prices for all pairs with pending stop orders.
   * Primary trigger is checkTriggers() called by matching engine after each trade.
   */
  async _periodicCheck() {
    if (this.pendingStopOrders.size === 0) return;

    const pairsToCheck = [...this.pairIndex.keys()];
    if (pairsToCheck.length === 0) return;

    for (const pair of pairsToCheck) {
      try {
        const price = await this._getMarketPrice(pair);
        if (price && price > 0) {
          await this.checkTriggers(pair, price);
          }
        } catch (err) {
        // Suppress — this is a backup check
      }
    }
  }

  /**
   * Get current market price for a trading pair.
   * Tries: order book midpoint → last trade price → best bid/ask
   */
  async _getMarketPrice(tradingPair) {
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

    // Fallback: query trades from Canton
    try {
      const token = await tokenProvider.getServiceToken();
      const packageId = config.canton.packageIds.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;
      const templateId = `${packageId}:Settlement:Trade`;
      
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateId],
        pageSize: 10,
      }, token);

      let latestPrice = null;
      let latestTs = 0;
      for (const c of (Array.isArray(contracts) ? contracts : [])) {
        const p = c.payload || c.createArgument || {};
        if (p.tradingPair === tradingPair && p.price) {
          const ts = new Date(p.timestamp || 0).getTime();
          if (ts > latestTs) {
            latestTs = ts;
            latestPrice = parseFloat(p.price);
          }
        }
      }
      return latestPrice;
    } catch (err) {
      return null;
    }
  }

  /**
   * Get pending stop-loss orders for a party.
   */
  getPendingStopOrders(partyId = null, tradingPair = null) {
    const result = [];
    for (const entry of this.pendingStopOrders.values()) {
      if (partyId && entry.partyId !== partyId) continue;
      if (tradingPair && entry.tradingPair !== tradingPair) continue;
      result.push({
        orderId: entry.orderId,
        orderContractId: entry.orderContractId,
        tradingPair: entry.tradingPair,
        orderType: entry.orderType,
        stopPrice: entry.stopPrice.toString(),
        quantity: entry.quantity,
        status: entry.status,
        registeredAt: entry.registeredAt,
        allocationContractId: entry.allocationContractId,
      });
    }
    return result;
  }

  /**
   * Legacy API: getActiveStopLosses (backward compat)
   */
  getActiveStopLosses(partyId) {
    return this.getPendingStopOrders(partyId).map(entry => ({
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
   * Called by exchangeController.js
   */
  registerStopLossLegacy(cfg) {
    return this.registerStopLoss({
      orderContractId: cfg.orderContractId,
      orderId: cfg.orderContractId, // Use contractId as orderId fallback
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
