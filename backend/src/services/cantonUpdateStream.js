/**
 * Canton Update Stream Service
 * 
 * Maintains an IN-MEMORY recent trades cache.
 * 
 * WHY: Canton's JSON API v2 has a hard node limit of 200 matching contracts
 * per query. When Settlement:Trade contracts exceed 200 (which happens in
 * production after ~200 trades), the trade query returns 0 results.
 * 
 * This service acts as a fallback: the matching engine writes every executed
 * trade here, and the tradeController merges Canton results with this cache.
 * 
 * The cache stores up to MAX_TRADES_PER_PAIR trades per trading pair,
 * keyed by tradeId to prevent duplicates when Canton results overlap.
 */

const MAX_TRADES_PER_PAIR = 200;
const MAX_TOTAL_TRADES = 1000;

class CantonUpdateStream {
  constructor() {
    this.initialized = false;
    // trades: Map<tradingPair, Map<tradeId, tradeRecord>>
    this.trades = new Map();
    this.totalTradeCount = 0;
  }

  async initialize() {
    console.log('[UpdateStream] Initialized with in-memory recent trades cache');
    this.initialized = true;
  }

  addOrder() {}
  removeOrder() {}

  /**
   * Store a trade in the in-memory cache.
   * Called by the matching engine after each successful match.
   * @param {Object} trade - Must have: tradeId, tradingPair, buyer, seller, price, quantity, timestamp
   */
  addTrade(trade) {
    if (!trade || !trade.tradingPair) return;
    const pair = trade.tradingPair;
    const tradeId = trade.tradeId || `trade-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    if (!this.trades.has(pair)) {
      this.trades.set(pair, new Map());
    }

    const pairTrades = this.trades.get(pair);

    // Skip if already cached (dedup by tradeId)
    if (pairTrades.has(tradeId)) return;

    pairTrades.set(tradeId, {
      ...trade,
      tradeId,
      _cachedAt: Date.now(),
    });
    this.totalTradeCount++;

    // Evict oldest if over limit for this pair
    if (pairTrades.size > MAX_TRADES_PER_PAIR) {
      const oldest = [...pairTrades.entries()]
        .sort((a, b) => new Date(a[1].timestamp || 0) - new Date(b[1].timestamp || 0));
      while (pairTrades.size > MAX_TRADES_PER_PAIR) {
        const [oldId] = oldest.shift();
        pairTrades.delete(oldId);
        this.totalTradeCount--;
      }
    }
  }

  getOrdersForPair() {
    return { buyOrders: [], sellOrders: [] };
  }
  
  getUserOrders() {
    return [];
  }
  
  /**
   * Get cached trades for a trading pair, newest first.
   * @param {string} tradingPair e.g. 'CC/CBTC'
   * @param {number} limit max results
   * @returns {Array} trade records sorted newest-first
   */
  getTradesForPair(tradingPair, limit = 50) {
    const pairTrades = this.trades.get(tradingPair);
    if (!pairTrades || pairTrades.size === 0) return [];
    return [...pairTrades.values()]
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  }
  
  /**
   * Get all cached trades across all pairs, newest first.
   * @param {number} limit max results
   * @returns {Array}
   */
  getAllTrades(limit = 100) {
    const all = [];
    for (const pairTrades of this.trades.values()) {
      for (const trade of pairTrades.values()) {
        all.push(trade);
      }
    }
    return all
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  }

  getStats() {
    return {
      totalOrders: 0,
      totalTrades: this.totalTradeCount,
      pairs: [...this.trades.keys()],
      initialized: this.initialized,
      note: 'In-memory recent trades cache (fallback for Canton 200+ limit)'
    };
  }

  stop() {}
}

let instance = null;

function getUpdateStream() {
  if (!instance) {
    instance = new CantonUpdateStream();
  }
  return instance;
}

module.exports = { CantonUpdateStream, getUpdateStream };
