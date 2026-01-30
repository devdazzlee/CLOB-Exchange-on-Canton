/**
 * Matching Engine Service - Operator Automation
 * 
 * Real matching engine that:
 * - Watches new orders via Canton JSON Ledger API v2
 * - Matches best price first, then FIFO/time priority
 * - Prevents self-trade (same party cannot match itself)
 * - Executes trades via submit-and-wait-for-transaction
 * 
 * API Used:
 * - POST /v2/state/active-contracts - Query orders
 * - POST /v2/commands/submit-and-wait-for-transaction - Execute matches
 * - POST /v2/updates/update-by-offset - Watch for new orders (future)
 */

const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');

class MatchingEngineService {
  constructor() {
    this.isRunning = false;
    this.matchingInterval = null;
    this.intervalMs = config.matchingEngine?.intervalMs || 2000;
    this.tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
    this.maxMatchesPerCycle = 10;
    console.log('[MatchingEngine] Initialized');
  }

  /**
   * Start the matching engine
   */
  start() {
    if (this.isRunning) {
      console.log('[MatchingEngine] Already running');
      return;
    }

    console.log('[MatchingEngine] Starting matching engine...');
    console.log(`[MatchingEngine] Polling interval: ${this.intervalMs} ms`);

    this.isRunning = true;
    this.matchingInterval = setInterval(() => {
      this.runMatchingCycle().catch(err => {
        console.error('[MatchingEngine] Error in matching cycle:', err.message);
      });
    }, this.intervalMs);
  }

  /**
   * Stop the matching engine
   */
  stop() {
    if (!this.isRunning) {
      console.log('[MatchingEngine] Not running');
      return;
    }

    console.log('[MatchingEngine] Stopping...');
    this.isRunning = false;
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
      this.matchingInterval = null;
    }
  }

  /**
   * Run one matching cycle
   */
  async runMatchingCycle() {
    try {
      const token = await tokenProvider.getServiceToken();
      let totalMatches = 0;

      for (const pair of this.tradingPairs) {
        if (totalMatches >= this.maxMatchesPerCycle) break;
        
        const matches = await this.matchOrdersForPair(pair, token);
        totalMatches += matches;
      }

      if (totalMatches > 0) {
        console.log(`[MatchingEngine] ✅ Cycle complete: ${totalMatches} match(es) executed`);
      }
    } catch (error) {
      console.error('[MatchingEngine] Error in matching cycle:', error.message);
    }
  }

  /**
   * Match orders for a specific trading pair
   */
  async matchOrdersForPair(tradingPair, token) {
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    if (!packageId) {
      console.warn('[MatchingEngine] Package ID not configured');
      return 0;
    }

    try {
      // First try to get orders from ReadModel cache (avoids 200+ limit issue)
      const { getReadModelService } = require('./readModelService');
      const readModel = getReadModelService();
      
      let orders = [];
      
      if (readModel) {
        // Get order book from cache
        const orderBook = readModel.getOrderBook(tradingPair);
        console.log(`[MatchingEngine] ReadModel for ${tradingPair}: bids=${orderBook?.bids?.length || 0}, asks=${orderBook?.asks?.length || 0}`);
        
        if (orderBook && (orderBook.bids?.length > 0 || orderBook.asks?.length > 0)) {
          // Extract orders from order book
          const buyOrders = (orderBook.bids || []).map(o => ({
            ...o,
            orderType: 'BUY',
            tradingPair,
            status: 'OPEN'
          }));
          const sellOrders = (orderBook.asks || []).map(o => ({
            ...o,
            orderType: 'SELL',
            tradingPair,
            status: 'OPEN'
          }));
          orders = [...buyOrders, ...sellOrders];
          console.log(`[MatchingEngine] Using ReadModel cache: ${buyOrders.length} buys, ${sellOrders.length} sells`);
        }
      } else {
        console.log('[MatchingEngine] ReadModel not available');
      }

      // Fallback to Canton query if ReadModel empty
      if (orders.length === 0) {
        console.log(`[MatchingEngine] No cached orders for ${tradingPair}, falling back to Canton query`);
        const contracts = await cantonService.queryActiveContracts({
          party: operatorPartyId,
          templateIds: [`${packageId}:Order:Order`],
          pageSize: 100
        }, token);

        orders = (Array.isArray(contracts) ? contracts : [])
          .map(c => {
            const payload = c.payload || c.createArgument || 
                           c.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
            return {
              contractId: c.contractId || c.contractEntry?.JsActiveContract?.createdEvent?.contractId,
              orderId: payload.orderId,
              owner: payload.owner,
              tradingPair: payload.tradingPair,
              orderType: payload.orderType,
              orderMode: payload.orderMode,
              price: payload.price?.Some || payload.price,
              quantity: parseFloat(payload.quantity || 0),
              filled: parseFloat(payload.filled || 0),
              status: payload.status,
              timestamp: payload.timestamp
            };
          })
          .filter(o => o.tradingPair === tradingPair && o.status === 'OPEN');
      }

      // Separate buys and sells
      const buyOrders = orders
        .filter(o => o.orderType === 'BUY')
        .sort((a, b) => {
          // Price-time priority: market orders first, then highest price, then earliest time
          const priceA = a.price ? parseFloat(a.price) : Infinity;
          const priceB = b.price ? parseFloat(b.price) : Infinity;
          if (priceA === Infinity && priceB !== Infinity) return -1;
          if (priceB === Infinity && priceA !== Infinity) return 1;
          if (priceA !== priceB) return priceB - priceA;
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      const sellOrders = orders
        .filter(o => o.orderType === 'SELL')
        .sort((a, b) => {
          // Price-time priority: market orders first, then lowest price, then earliest time
          const priceA = a.price ? parseFloat(a.price) : 0;
          const priceB = b.price ? parseFloat(b.price) : 0;
          if (priceA === 0 && priceB !== 0) return -1;
          if (priceB === 0 && priceA !== 0) return 1;
          if (priceA !== priceB) return priceA - priceB;
          return new Date(a.timestamp) - new Date(b.timestamp);
        });

      let matchCount = 0;

      // Try to match orders
      for (const buyOrder of buyOrders) {
        if (matchCount >= this.maxMatchesPerCycle) break;

        for (const sellOrder of sellOrders) {
          if (matchCount >= this.maxMatchesPerCycle) break;

          // Check if orders can match
          if (this.canMatch(buyOrder, sellOrder)) {
            const success = await this.executeMatch(buyOrder, sellOrder, token);
            if (success) {
              matchCount++;
              console.log(`[MatchingEngine] ✅ Match: ${buyOrder.orderId} <-> ${sellOrder.orderId}`);
              
              // Broadcast trade via WebSocket
              this.broadcastTrade(buyOrder, sellOrder, tradingPair);
              break; // Move to next buy order
            }
          }
        }
      }

      return matchCount;
    } catch (error) {
      console.error(`[MatchingEngine] Error matching ${tradingPair}:`, error.message);
      return 0;
    }
  }

  /**
   * Check if two orders can match
   */
  canMatch(buyOrder, sellOrder) {
    // Prevent self-trading
    if (buyOrder.owner === sellOrder.owner) {
      return false;
    }

    // Both orders must be OPEN
    if (buyOrder.status !== 'OPEN' || sellOrder.status !== 'OPEN') {
      return false;
    }

    // Calculate remaining quantities
    const buyRemaining = buyOrder.quantity - buyOrder.filled;
    const sellRemaining = sellOrder.quantity - sellOrder.filled;

    if (buyRemaining <= 0 || sellRemaining <= 0) {
      return false;
    }

    // Price matching
    const buyPrice = buyOrder.price ? parseFloat(buyOrder.price) : Infinity;
    const sellPrice = sellOrder.price ? parseFloat(sellOrder.price) : 0;

    // Market orders match with anything
    if (buyOrder.orderMode === 'MARKET' || sellOrder.orderMode === 'MARKET') {
      return true;
    }

    // Limit orders: buy price must be >= sell price
    return buyPrice >= sellPrice;
  }

  /**
   * Execute a match between two orders
   */
  async executeMatch(buyOrder, sellOrder, token) {
    try {
      const packageId = config.canton.packageIds.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;

      // Calculate trade details
      const buyRemaining = buyOrder.quantity - buyOrder.filled;
      const sellRemaining = sellOrder.quantity - sellOrder.filled;
      const tradeQuantity = Math.min(buyRemaining, sellRemaining);
      
      // Determine trade price (use sell price for limit orders, or last known price)
      const tradePrice = sellOrder.price ? parseFloat(sellOrder.price) : 
                        (buyOrder.price ? parseFloat(buyOrder.price) : 0);

      const quoteAmount = tradeQuantity * tradePrice;

      // Generate trade ID
      const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      console.log(`[MatchingEngine] Executing match:`, {
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        quantity: tradeQuantity,
        price: tradePrice,
        quoteAmount
      });

      // Fill the buy order
      await cantonService.exerciseChoice({
        token,
        actAsParty: operatorPartyId,
        templateId: `${packageId}:Order:Order`,
        contractId: buyOrder.contractId,
        choice: 'FillOrder',
        choiceArgument: { fillQuantity: tradeQuantity.toString() },
        readAs: [operatorPartyId, buyOrder.owner]
      });

      // Fill the sell order
      await cantonService.exerciseChoice({
        token,
        actAsParty: operatorPartyId,
        templateId: `${packageId}:Order:Order`,
        contractId: sellOrder.contractId,
        choice: 'FillOrder',
        choiceArgument: { fillQuantity: tradeQuantity.toString() },
        readAs: [operatorPartyId, sellOrder.owner]
      });

      // Create Trade record
      await cantonService.createContractWithTransaction({
        token,
        actAsParty: operatorPartyId,
        templateId: `${packageId}:Trade:Trade`,
        createArguments: {
          tradeId,
          buyer: buyOrder.owner,
          seller: sellOrder.owner,
          tradingPair: buyOrder.tradingPair,
          price: tradePrice.toString(),
          quantity: tradeQuantity.toString(),
          timestamp: new Date().toISOString(),
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId
        },
        readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner]
      });

      return true;
    } catch (error) {
      console.error('[MatchingEngine] Error executing match:', error.message);
      return false;
    }
  }

  /**
   * Broadcast trade via WebSocket
   */
  broadcastTrade(buyOrder, sellOrder, tradingPair) {
    if (global.broadcastWebSocket) {
      const tradePrice = sellOrder.price ? parseFloat(sellOrder.price) : 
                        (buyOrder.price ? parseFloat(buyOrder.price) : 0);
      const tradeQuantity = Math.min(
        buyOrder.quantity - buyOrder.filled,
        sellOrder.quantity - sellOrder.filled
      );

      global.broadcastWebSocket(`trades:${tradingPair}`, {
        type: 'NEW_TRADE',
        tradingPair,
        buyer: buyOrder.owner,
        seller: sellOrder.owner,
        price: tradePrice,
        quantity: tradeQuantity,
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        timestamp: new Date().toISOString()
      });

      // Also broadcast order book update
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'TRADE_EXECUTED',
        tradingPair,
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        timestamp: new Date().toISOString()
      });
    }
  }
}

// Singleton
const matchingEngineService = new MatchingEngineService();
module.exports = matchingEngineService;
