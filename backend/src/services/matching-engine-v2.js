/**
 * Matching Engine V2 - Token Standard Version
 * 
 * Uses proper token standard for settlement:
 * - Matches OrderV3 contracts (which have locked Holdings)
 * - Creates SettlementInstruction for DvP
 * - Executes atomic swap via Settlement contract
 * 
 * Flow:
 * 1. Poll for open orders (OrderV3)
 * 2. Find crossing orders (buy.price >= sell.price)
 * 3. Create SettlementInstruction with both locked holdings
 * 4. Execute Settlement_Execute choice for atomic DvP
 * 5. Both parties receive their tokens atomically
 */

const cantonService = require('./cantonService');
const { getOrderServiceV2 } = require('./order-service-v2');
const { getSettlementService } = require('./settlementService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

// Helper to get canton service instance
const getCantonService = () => cantonService;

// Template IDs - Token Standard package
const getTemplateIds = () => {
  const tokenStandardPackageId = config.canton?.tokenStandardPackageId || 
                                  process.env.TOKEN_STANDARD_PACKAGE_ID ||
                                  '813a7f5a2d053bb8e408035cf0a7f86d216f62b216eb6a6e157b253d0d2ccb69';
  return {
    order: `${tokenStandardPackageId}:OrderV3:Order`,
    holding: `${tokenStandardPackageId}:Holding:Holding`,
    settlement: `${tokenStandardPackageId}:Settlement:SettlementInstruction`,
    trade: `${tokenStandardPackageId}:Settlement:Trade`,
  };
};

class MatchingEngineV2 {
  constructor() {
    this.cantonService = null;
    this.orderService = null;
    this.settlementService = null;
    this.isRunning = false;
    this.matchInterval = parseInt(process.env.MATCHING_ENGINE_INTERVAL_MS) || 1000;
    this.supportedPairs = ['BTC/USDT', 'cBTC/USDT', 'ETH/USDT', 'SOL/USDT'];
  }

  async initialize() {
    this.cantonService = getCantonService();
    this.orderService = getOrderServiceV2();
    this.settlementService = getSettlementService();
    
    await this.orderService.initialize();
    await this.settlementService.initialize();
    
    console.log('[MatchingEngineV2] Initialized with Token Standard DvP');
  }

  /**
   * Start the matching engine
   */
  async start() {
    if (this.isRunning) {
      console.log('[MatchingEngineV2] Already running');
      return;
    }

    console.log('[MatchingEngineV2] Starting matching engine...');
    this.isRunning = true;

    // Run initial match
    await this.runMatchCycle();

    // Start periodic matching
    this.matchIntervalId = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.runMatchCycle();
        } catch (error) {
          console.error('[MatchingEngineV2] Match cycle error:', error.message);
        }
      }
    }, this.matchInterval);

    console.log(`[MatchingEngineV2] Running every ${this.matchInterval}ms`);
  }

  /**
   * Stop the matching engine
   */
  stop() {
    this.isRunning = false;
    if (this.matchIntervalId) {
      clearInterval(this.matchIntervalId);
      this.matchIntervalId = null;
    }
    console.log('[MatchingEngineV2] Stopped');
  }

  /**
   * Run one matching cycle for all pairs
   */
  async runMatchCycle() {
    const adminToken = await tokenProvider.getServiceToken();
    
    for (const pair of this.supportedPairs) {
      try {
        await this.matchPair(pair, adminToken);
      } catch (error) {
        console.error(`[MatchingEngineV2] Error matching ${pair}:`, error.message);
      }
    }
  }

  /**
   * Match orders for a trading pair
   */
  async matchPair(tradingPair, adminToken) {
    const orders = await this.orderService.getOpenOrders(tradingPair, adminToken);
    
    if (orders.length < 2) {
      return; // Need at least 2 orders to match
    }

    // Separate and sort
    const buyOrders = orders
      .filter(o => o.side === 'Buy')
      .sort((a, b) => {
        // Market orders first, then by price descending
        if (a.type === 'Market' && b.type !== 'Market') return -1;
        if (b.type === 'Market' && a.type !== 'Market') return 1;
        return b.price - a.price;
      });

    const sellOrders = orders
      .filter(o => o.side === 'Sell')
      .sort((a, b) => {
        // Market orders first, then by price ascending
        if (a.type === 'Market' && b.type !== 'Market') return -1;
        if (b.type === 'Market' && a.type !== 'Market') return 1;
        return a.price - b.price;
      });

    // Find and execute matches
    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        // Check if orders can match
        const canMatch = this.canMatch(buyOrder, sellOrder);
        
        if (canMatch) {
          try {
            await this.executeMatch(buyOrder, sellOrder, tradingPair, adminToken);
            // After a match, break to re-fetch orders (they may have changed)
            return;
          } catch (error) {
            console.error(`[MatchingEngineV2] Match execution failed:`, error.message);
          }
        }
      }
    }
  }

  /**
   * Check if two orders can match
   */
  canMatch(buyOrder, sellOrder) {
    // No self-trade (removed per client request)
    // if (buyOrder.owner === sellOrder.owner) return false;

    // Both orders must be open
    if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) {
      return false;
    }

    // Market orders always match
    if (buyOrder.type === 'Market' || sellOrder.type === 'Market') {
      return true;
    }

    // Limit orders: buy price must be >= sell price
    return buyOrder.price >= sellOrder.price;
  }

  /**
   * Execute a match between two orders
   */
  async executeMatch(buyOrder, sellOrder, tradingPair, adminToken) {
    // Determine fill quantity (minimum of both remaining)
    const fillQuantity = Math.min(buyOrder.remaining, sellOrder.remaining);
    
    // Determine fill price (maker price - the sell order's price)
    const fillPrice = sellOrder.type === 'Market' ? buyOrder.price : sellOrder.price;
    
    console.log(`[MatchingEngineV2] Matching: ${tradingPair}`);
    console.log(`  Buy: ${buyOrder.remaining} @ ${buyOrder.price || 'MARKET'} (${buyOrder.owner.substring(0, 20)}...)`);
    console.log(`  Sell: ${sellOrder.remaining} @ ${sellOrder.price || 'MARKET'} (${sellOrder.owner.substring(0, 20)}...)`);
    console.log(`  Fill: ${fillQuantity} @ ${fillPrice}`);

    // Calculate amounts
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    const baseAmount = fillQuantity;
    const quoteAmount = fillQuantity * fillPrice;

    const settlementService = getSettlementService();

    try {
      // Create and execute settlement atomically
      const result = await settlementService.settleMatch({
        buyOrder: {
          ...buyOrder,
          tradingPair,
          lockedHoldingCid: buyOrder.lockedHoldingCid,
        },
        sellOrder: {
          ...sellOrder,
          tradingPair,
          lockedHoldingCid: sellOrder.lockedHoldingCid,
        },
        fillQuantity,
        fillPrice,
      }, adminToken);

      console.log(`[MatchingEngineV2] ✓ Trade executed: ${fillQuantity} ${baseSymbol} @ ${fillPrice}`);
      console.log(`  Buyer receives: ${baseAmount} ${baseSymbol}`);
      console.log(`  Seller receives: ${quoteAmount} ${quoteSymbol}`);

      return result;
    } catch (error) {
      console.error(`[MatchingEngineV2] Settlement failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get current matching status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      matchInterval: this.matchInterval,
      supportedPairs: this.supportedPairs,
      tokenStandard: true,
      settlementMethod: 'DvP (Delivery vs Payment)',
    };
  }
}

// Singleton
let matchingEngineV2Instance = null;

function getMatchingEngineV2() {
  if (!matchingEngineV2Instance) {
    matchingEngineV2Instance = new MatchingEngineV2();
  }
  return matchingEngineV2Instance;
}

// Auto-start if enabled
async function startIfEnabled() {
  const enabled = process.env.MATCHING_ENGINE_ENABLED === 'true';
  if (enabled) {
    const engine = getMatchingEngineV2();
    await engine.initialize();
    await engine.start();
  }
}

module.exports = {
  MatchingEngineV2,
  getMatchingEngineV2,
  startIfEnabled,
};
