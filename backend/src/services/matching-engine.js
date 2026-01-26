/**
 * Matching Engine Bot
 * Continuously monitors the order book and executes matches when buy/sell orders overlap
 *
 * This is the critical off-chain automation that makes the exchange work:
 * - FIFO Execution: Price-time priority
 * - Partial Fills: Handles mismatched sizes
 * - Self-Trade Prevention: Checks owner before matching
 */

const CantonAdmin = require('./canton-admin');
const config = require('../config');
const tradeStore = require('./trade-store');
const { extractTradesFromEvents } = require('./trade-utils');

function recordTradesFromResult(result) {
  const trades = extractTradesFromEvents(result?.events);
  if (trades.length === 0) return [];

  trades.forEach((trade) => {
    tradeStore.addTrade(trade);
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${trade.tradingPair}`, {
        type: 'NEW_TRADE',
        ...trade,
      });
      global.broadcastWebSocket('trades:all', {
        type: 'NEW_TRADE',
        ...trade,
      });
    }
  });

  return trades;
}

class MatchingEngine {
  constructor() {
    this.cantonAdmin = new CantonAdmin();
    this.isRunning = false;
    this.pollingInterval = 2000; // Poll every 2 seconds
    this.matchingInProgress = false;
    this.lastProcessedOrders = new Set();
    this.adminToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get admin token with caching
   */
  async getAdminToken() {
    if (this.adminToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.adminToken;
    }

    this.adminToken = await this.cantonAdmin.getAdminToken();
    this.tokenExpiry = Date.now() + (25 * 60 * 1000); // 25 minutes (token expires in 30)
    return this.adminToken;
  }

  /**
   * Start the matching engine
   */
  async start() {
    if (this.isRunning) {
      console.log('[MatchingEngine] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[MatchingEngine] Starting matching engine...');
    console.log('[MatchingEngine] Polling interval:', this.pollingInterval, 'ms');

    // Start the matching loop
    this.matchLoop();
  }

  /**
   * Stop the matching engine
   */
  stop() {
    console.log('[MatchingEngine] Stopping matching engine...');
    this.isRunning = false;
  }

  /**
   * Main matching loop
   */
  async matchLoop() {
    while (this.isRunning) {
      try {
        await this.runMatchingCycle();
      } catch (error) {
        console.error('[MatchingEngine] Error in matching cycle:', error.message);
      }

      // Wait before next cycle
      await this.sleep(this.pollingInterval);
    }

    console.log('[MatchingEngine] Stopped');
  }

  /**
   * Run one matching cycle
   */
  async runMatchingCycle() {
    if (this.matchingInProgress) {
      return; // Skip if already processing
    }

    try {
      this.matchingInProgress = true;

      // Get admin token
      const adminToken = await this.getAdminToken();

      // Step 1: Get all OrderBook contracts
      const orderBooks = await this.queryContracts(this.getMasterOrderBookTemplateId(), adminToken);

      if (orderBooks.length === 0) {
        // No order books yet
        return;
      }

      // Step 2: For each order book, find matching orders
      for (const orderBook of orderBooks) {
        await this.processOrderBook(orderBook, adminToken);
      }
    } finally {
      this.matchingInProgress = false;
    }
  }

  /**
   * Process a single order book
   */
  async processOrderBook(orderBook, adminToken) {
    try {
      const contractId = orderBook.contractId;
      const payload = orderBook.payload;
      const operator = payload.operator;
      const tradingPair = payload.tradingPair;

      console.log(`[MatchingEngine] Processing order book: ${tradingPair}`);

      // Get all orders for this order book
      const buyOrderCids = payload.buyOrders || [];
      const sellOrderCids = payload.sellOrders || [];

      if (buyOrderCids.length === 0 || sellOrderCids.length === 0) {
        return; // No matches possible
      }

      // Fetch full order details
      const buyOrders = await this.fetchOrders(buyOrderCids, adminToken);
      const sellOrders = await this.fetchOrders(sellOrderCids, adminToken);

      // Sort orders by price-time priority
      const sortedBuys = this.sortBuyOrders(buyOrders);
      const sortedSells = this.sortSellOrders(sellOrders);

      // Find matches
      const matches = this.findMatches(sortedBuys, sortedSells);

      if (matches.length === 0) {
        return;
      }

      console.log(`[MatchingEngine] Found ${matches.length} potential matches for ${tradingPair}`);

      // Execute matches
      for (const match of matches) {
        await this.executeMatch(contractId, match, operator, adminToken);
      }
    } catch (error) {
      console.error('[MatchingEngine] Error processing order book:', error.message);
    }
  }

  /**
   * Get ledger end offset
   */
  async getLedgerEndOffset(adminToken) {
    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get ledger end: ${response.status}`);
    }

    const data = await response.json();
    return data.offset || data.ledgerEnd || '0';
  }

  /**
   * Query active contracts by template (revert to working filter structure)
   */
  async queryContracts(templateId, adminToken, limit = 100) {
    // Get current ledger end
    const activeAtOffset = await this.getLedgerEndOffset(adminToken);

    // Use actual operator party ID from config
    const operatorPartyId = config.canton.operatorPartyId;

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=${limit}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        readAs: [operatorPartyId],
        activeAtOffset,
        verbose: false,
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              inclusive: {
                templateIds: [templateId],
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MatchingEngine] Query error details:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        templateId: templateId,
        operatorPartyId: operatorPartyId
      });
      throw new Error(`Failed to query contracts: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    return contracts.map(c => ({
      contractId: c.contractId || c.contract_id,
      payload: c.payload || c.argument,
    }));
  }

  getMasterOrderBookTemplateId() {
    const packageId = config.canton.packageIds?.clobExchange || config.canton.packageIds?.masterOrderBook;
    if (!packageId) {
      throw new Error('Missing package ID for MasterOrderBook template');
    }
    return {
      packageId,
      moduleName: 'MasterOrderBook',
      entityName: 'MasterOrderBook',
    };
  }

  /**
   * Fetch order contracts
   */
  async fetchOrders(orderCids, adminToken) {
    const orders = [];

    for (const cid of orderCids) {
      try {
        const order = await this.fetchContract(cid, adminToken);
        if (order) {
          orders.push({
            contractId: cid,
            ...order.payload,
          });
        }
      } catch (error) {
        console.warn('[MatchingEngine] Failed to fetch order:', cid, error.message);
      }
    }

    return orders;
  }

  /**
   * Fetch single contract using correct endpoint
   */
  async fetchContract(contractId, adminToken) {
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/contracts/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        contractId: contractId,
      }),
    });

    if (!response.ok) {
      console.warn('[MatchingEngine] Failed to fetch contract:', contractId, response.status);
      return null;
    }

    const data = await response.json();
    return {
      contractId: data.contractId || contractId,
      payload: data.payload || data.argument,
    };
  }

  /**
   * Sort buy orders (highest price first, then earliest timestamp)
   */
  sortBuyOrders(orders) {
    return orders.sort((a, b) => {
      // Market orders (no price) have highest priority
      if (!a.price && b.price) return -1;
      if (a.price && !b.price) return 1;
      if (!a.price && !b.price) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }

      // Higher price has priority
      const priceA = parseFloat(a.price);
      const priceB = parseFloat(b.price);

      if (priceA > priceB) return -1;
      if (priceA < priceB) return 1;

      // Same price: earlier timestamp wins
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  /**
   * Sort sell orders (lowest price first, then earliest timestamp)
   */
  sortSellOrders(orders) {
    return orders.sort((a, b) => {
      // Market orders (no price) have highest priority
      if (!a.price && b.price) return -1;
      if (a.price && !b.price) return 1;
      if (!a.price && !b.price) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }

      // Lower price has priority
      const priceA = parseFloat(a.price);
      const priceB = parseFloat(b.price);

      if (priceA < priceB) return -1;
      if (priceA > priceB) return 1;

      // Same price: earlier timestamp wins
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  /**
   * Find matching orders
   */
  findMatches(buyOrders, sellOrders) {
    const matches = [];

    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        // Self-trade check
        if (buyOrder.owner === sellOrder.owner) {
          continue;
        }

        // Check if orders can match
        if (this.canOrdersMatch(buyOrder, sellOrder)) {
          matches.push({
            buyOrderCid: buyOrder.contractId,
            sellOrderCid: sellOrder.contractId,
            buyOrder,
            sellOrder,
          });

          // For now, only match one pair per cycle to avoid conflicts
          // In production, you might want to batch multiple non-conflicting matches
          break;
        }
      }

      if (matches.length > 0) break;
    }

    return matches;
  }

  /**
   * Check if two orders can match
   */
  canOrdersMatch(buyOrder, sellOrder) {
    // Both must have remaining quantity
    const buyRemaining = parseFloat(buyOrder.quantity) - parseFloat(buyOrder.filled || 0);
    const sellRemaining = parseFloat(sellOrder.quantity) - parseFloat(sellOrder.filled || 0);

    if (buyRemaining <= 0 || sellRemaining <= 0) {
      return false;
    }

    // Check price overlap
    if (buyOrder.price && sellOrder.price) {
      const buyPrice = parseFloat(buyOrder.price);
      const sellPrice = parseFloat(sellOrder.price);
      return buyPrice >= sellPrice;
    }

    // Market orders always match
    return true;
  }

  /**
   * Execute a match
   */
  async executeMatch(orderBookCid, match, operator, adminToken) {
    try {
      console.log('[MatchingEngine] Executing match:');
      console.log('  Buy Order:', match.buyOrderCid.substring(0, 20) + '...');
      console.log('  Sell Order:', match.sellOrderCid.substring(0, 20) + '...');

      // Call MatchOrders choice on OrderBook using proper exerciseChoice
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: operator,
        templateId: this.getMasterOrderBookTemplateId(),
        contractId: orderBookCid,
        choice: 'MatchOrders',
        choiceArgument: {
          buyCid: match.buyOrderCid,
          sellCid: match.sellOrderCid,
        },
        readAs: [operator],
      });

      console.log('[MatchingEngine] ✓ Match executed successfully');

      recordTradesFromResult(result);

      // Emit WebSocket event for real-time updates
      this.emitMatchEvent(match, result);

      // Mark as processed
      this.lastProcessedOrders.add(match.buyOrderCid);
      this.lastProcessedOrders.add(match.sellOrderCid);

      // Clean up old entries (keep last 1000)
      if (this.lastProcessedOrders.size > 1000) {
        const arr = Array.from(this.lastProcessedOrders);
        this.lastProcessedOrders = new Set(arr.slice(-1000));
      }
    } catch (error) {
      console.error('[MatchingEngine] Error executing match:', error.message);
    }
  }

  /**
   * Emit match event via WebSocket
   */
  emitMatchEvent(match, result) {
    try {
      // Use global broadcast function if available
      if (global.broadcastWebSocket) {
        const tradingPair = match.buyOrder.tradingPair || 'UNKNOWN';

        // Broadcast to orderbook channel
        global.broadcastWebSocket(`orderbook:${tradingPair}`, {
          type: 'MATCH',
          buyOrderCid: match.buyOrderCid,
          sellOrderCid: match.sellOrderCid,
          timestamp: new Date().toISOString(),
        });

        // Broadcast to trades channel
        global.broadcastWebSocket(`trades:${tradingPair}`, {
          type: 'NEW_TRADE',
          tradingPair: tradingPair,
          timestamp: new Date().toISOString(),
        });

        console.log('[MatchingEngine] ✓ WebSocket events emitted');
      }
    } catch (error) {
      console.error('[MatchingEngine] Error emitting WebSocket event:', error.message);
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update polling interval
   */
  setPollingInterval(ms) {
    this.pollingInterval = ms;
    console.log('[MatchingEngine] Polling interval updated to:', ms, 'ms');
  }
}

// Singleton instance
let matchingEngineInstance = null;

function getMatchingEngine() {
  if (!matchingEngineInstance) {
    matchingEngineInstance = new MatchingEngine();
  }
  return matchingEngineInstance;
}

module.exports = {
  MatchingEngine,
  getMatchingEngine,
};
