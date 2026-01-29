/**
 * Stop-Loss Service
 * Milestone 4: Stop-loss trigger logic and execution
 * 
 * Monitors price movements and triggers stop-loss orders when price thresholds are breached
 */

const EventEmitter = require('events');
const cantonService = require('./cantonService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class StopLossService extends EventEmitter {
  constructor() {
    super();
    this.activeStopLosses = new Map(); // Map<orderContractId, stopLossConfig>
    this.priceMonitors = new Map(); // Map<tradingPair, Set<orderContractId>>
    this.isRunning = false;
    this.checkInterval = null;
    this.checkIntervalMs = 1000; // Check every second
  }

  /**
   * Start the stop-loss monitoring service
   */
  async start() {
    if (this.isRunning) {
      console.log('[StopLoss] Service already running');
      return;
    }

    console.log('[StopLoss] Starting stop-loss monitoring service...');
    this.isRunning = true;

    // Start periodic price checks
    this.checkInterval = setInterval(() => {
      this.checkStopLosses().catch(err => {
        console.error('[StopLoss] Error checking stop-losses:', err);
      });
    }, this.checkIntervalMs);

    console.log('[StopLoss] ✅ Service started');
  }

  /**
   * Stop the stop-loss monitoring service
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[StopLoss] Stopping stop-loss monitoring service...');
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log('[StopLoss] ✅ Service stopped');
  }

  /**
   * Register a stop-loss order
   * 
   * @param {Object} config - Stop-loss configuration
   * @param {string} config.orderContractId - The order contract ID
   * @param {string} config.tradingPair - Trading pair (e.g., "BTC/USDT")
   * @param {string} config.orderType - "BUY" or "SELL"
   * @param {number} config.stopLossPrice - Price at which to trigger stop-loss
   * @param {string} config.partyId - Owner party ID
   * @param {string} config.originalPrice - Original order price for reference
   */
  registerStopLoss(config) {
    const {
      orderContractId,
      tradingPair,
      orderType,
      stopLossPrice,
      partyId,
      originalPrice
    } = config;

    if (!orderContractId || !tradingPair || !stopLossPrice) {
      throw new Error('Missing required stop-loss configuration');
    }

    console.log(`[StopLoss] Registering stop-loss for order ${orderContractId.substring(0, 20)}...`);
    console.log(`  Trading Pair: ${tradingPair}`);
    console.log(`  Order Type: ${orderType}`);
    console.log(`  Stop-Loss Price: ${stopLossPrice}`);
    console.log(`  Original Price: ${originalPrice}`);

    // Store stop-loss configuration
    this.activeStopLosses.set(orderContractId, {
      orderContractId,
      tradingPair,
      orderType,
      stopLossPrice: parseFloat(stopLossPrice),
      partyId,
      originalPrice: parseFloat(originalPrice),
      registeredAt: new Date().toISOString()
    });

    // Add to price monitor for this trading pair
    if (!this.priceMonitors.has(tradingPair)) {
      this.priceMonitors.set(tradingPair, new Set());
    }
    this.priceMonitors.get(tradingPair).add(orderContractId);

    this.emit('stopLossRegistered', { orderContractId, tradingPair, stopLossPrice });
  }

  /**
   * Unregister a stop-loss order
   */
  unregisterStopLoss(orderContractId) {
    const config = this.activeStopLosses.get(orderContractId);
    if (!config) {
      return;
    }

    console.log(`[StopLoss] Unregistering stop-loss for order ${orderContractId.substring(0, 20)}...`);

    // Remove from price monitor
    const monitors = this.priceMonitors.get(config.tradingPair);
    if (monitors) {
      monitors.delete(orderContractId);
      if (monitors.size === 0) {
        this.priceMonitors.delete(config.tradingPair);
      }
    }

    this.activeStopLosses.delete(orderContractId);
    this.emit('stopLossUnregistered', { orderContractId });
  }

  /**
   * Check all active stop-losses and trigger if conditions are met
   */
  async checkStopLosses() {
    if (this.activeStopLosses.size === 0) {
      return; // No active stop-losses
    }

    try {
      const adminToken = await tokenProvider.getAdminToken();

      // Group by trading pair for efficient price fetching
      const pairsToCheck = new Set();
      for (const config of this.activeStopLosses.values()) {
        pairsToCheck.add(config.tradingPair);
      }

      // Fetch current prices for all trading pairs
      const prices = await this.fetchCurrentPrices(Array.from(pairsToCheck), adminToken);

      // Check each stop-loss
      const triggers = [];
      for (const [orderContractId, config] of this.activeStopLosses.entries()) {
        const currentPrice = prices.get(config.tradingPair);
        if (!currentPrice) {
          continue; // Price not available, skip
        }

        const shouldTrigger = this.shouldTriggerStopLoss(config, currentPrice);
        if (shouldTrigger) {
          triggers.push({ orderContractId, config, currentPrice });
        }
      }

      // Execute triggered stop-losses
      for (const trigger of triggers) {
        await this.executeStopLoss(trigger.orderContractId, trigger.config, trigger.currentPrice, adminToken);
      }

    } catch (error) {
      console.error('[StopLoss] Error checking stop-losses:', error);
    }
  }

  /**
   * Determine if stop-loss should trigger based on price movement
   */
  shouldTriggerStopLoss(config, currentPrice) {
    const { orderType, stopLossPrice, originalPrice } = config;

    // For BUY orders: trigger if price drops below stop-loss
    // For SELL orders: trigger if price rises above stop-loss
    if (orderType === 'BUY') {
      return currentPrice <= stopLossPrice;
    } else if (orderType === 'SELL') {
      return currentPrice >= stopLossPrice;
    }

    return false;
  }

  /**
   * Execute a stop-loss order (cancel the original order)
   */
  async executeStopLoss(orderContractId, config, currentPrice, adminToken) {
    try {
      console.log(`[StopLoss] 🚨 Triggering stop-loss for order ${orderContractId.substring(0, 20)}...`);
      console.log(`  Current Price: ${currentPrice}`);
      console.log(`  Stop-Loss Price: ${config.stopLossPrice}`);
      console.log(`  Order Type: ${config.orderType}`);

      // Get order template ID
      const { orderTemplateId } = require('../utils/templateId');
      const templateId = orderTemplateId();

      // Cancel the order via DAML choice
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: config.partyId,
        templateId,
        contractId: orderContractId,
        choice: 'CancelOrder',
        choiceArgument: {},
        readAs: [config.partyId]
      });

      console.log(`[StopLoss] ✅ Stop-loss executed successfully for order ${orderContractId.substring(0, 20)}`);

      // Unregister the stop-loss
      this.unregisterStopLoss(orderContractId);

      // Emit event
      this.emit('stopLossTriggered', {
        orderContractId,
        config,
        currentPrice,
        triggeredAt: new Date().toISOString()
      });

      return result;
    } catch (error) {
      console.error(`[StopLoss] ❌ Failed to execute stop-loss for order ${orderContractId.substring(0, 20)}:`, error);
      this.emit('stopLossError', { orderContractId, config, error });
      throw error;
    }
  }

  /**
   * Fetch current prices for trading pairs
   * Uses the last trade price or best bid/ask from order book
   */
  async fetchCurrentPrices(tradingPairs, adminToken) {
    const prices = new Map();

    try {
      // For each trading pair, get the latest trade price or best bid/ask
      for (const pair of tradingPairs) {
        // Try to get from order book (best bid/ask midpoint)
        try {
          const orderBookPrice = await this.getOrderBookPrice(pair, adminToken);
          if (orderBookPrice && orderBookPrice > 0) {
            prices.set(pair, orderBookPrice);
            continue;
          }
        } catch (err) {
          console.warn(`[StopLoss] Failed to get order book price for ${pair}:`, err.message);
        }

        // Fallback: try to get from recent trades
        try {
          const tradePrice = await this.getLatestTradePrice(pair, adminToken);
          if (tradePrice && tradePrice > 0) {
            prices.set(pair, tradePrice);
            continue;
          }
        } catch (err) {
          console.warn(`[StopLoss] Failed to get trade price for ${pair}:`, err.message);
        }
      }
    } catch (error) {
      console.error('[StopLoss] Error fetching current prices:', error);
    }

    return prices;
  }

  /**
   * Get price from order book (best bid/ask midpoint)
   */
  async getOrderBookPrice(tradingPair, adminToken) {
    try {
      const orderBookService = require('./orderBookService');
      const orderBook = await orderBookService.getOrderBook(tradingPair);
      
      if (orderBook.buyOrders.length > 0 && orderBook.sellOrders.length > 0) {
        const bestBid = parseFloat(orderBook.buyOrders[0]?.price || 0);
        const bestAsk = parseFloat(orderBook.sellOrders[0]?.price || 0);
        
        if (bestBid > 0 && bestAsk > 0) {
          return (bestBid + bestAsk) / 2; // Midpoint
        } else if (bestBid > 0) {
          return bestBid;
        } else if (bestAsk > 0) {
          return bestAsk;
        }
      }
      
      // Fallback to last price
      if (orderBook.lastPrice) {
        return parseFloat(orderBook.lastPrice);
      }
      
      return null;
    } catch (error) {
      console.error(`[StopLoss] Error getting order book price for ${tradingPair}:`, error);
      return null;
    }
  }

  /**
   * Get latest trade price for a trading pair
   */
  async getLatestTradePrice(tradingPair, adminToken) {
    try {
      const cantonService = require('./cantonService');
      const packageId = config.canton.packageIds.clobExchange;
      const templateId = `${packageId}:Trade:Trade`;
      
      // Query recent trades
      const contracts = await cantonService.queryActiveContracts({
        templateIds: [templateId]
      }, adminToken);
      
      const contractArray = Array.isArray(contracts) ? contracts : (contracts.activeContracts || []);
      
      // Find most recent trade for this pair
      let latestTrade = null;
      let latestTimestamp = 0;
      
      for (const contract of contractArray) {
        const payload = contract.payload || 
                       contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument ||
                       contract.createArgument ||
                       {};
        
        if (payload.tradingPair === tradingPair && payload.price) {
          const timestamp = new Date(payload.timestamp || 0).getTime();
          if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            latestTrade = payload;
          }
        }
      }
      
      return latestTrade ? parseFloat(latestTrade.price) : null;
    } catch (error) {
      console.error(`[StopLoss] Error getting trade price for ${tradingPair}:`, error);
      return null;
    }
  }

  /**
   * Get active stop-losses for a party
   */
  getActiveStopLosses(partyId) {
    const result = [];
    for (const config of this.activeStopLosses.values()) {
      if (config.partyId === partyId) {
        result.push({
          orderContractId: config.orderContractId,
          tradingPair: config.tradingPair,
          orderType: config.orderType,
          stopLossPrice: config.stopLossPrice,
          originalPrice: config.originalPrice,
          registeredAt: config.registeredAt
        });
      }
    }
    return result;
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
  getStopLossService
};
