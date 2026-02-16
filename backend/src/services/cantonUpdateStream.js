/**
 * Canton Update Stream Service
 * 
 * Maintains an IN-MEMORY + FILE-BACKED recent trades cache.
 * 
 * WHY: Canton's JSON API v2 has a hard node limit of 200 matching contracts
 * per query. When Settlement:Trade contracts exceed 200 (which happens in
 * production after ~200 trades), the trade query returns 0 results.
 * 
 * This service acts as the PRIMARY source for recent trades:
 * - The matching engine writes every executed trade here
 * - The tradeController reads from this cache when Canton query fails
 * - Trades are persisted to disk so they survive server restarts
 * 
 * The cache stores up to MAX_TRADES_PER_PAIR trades per trading pair,
 * keyed by tradeId to prevent duplicates when Canton results overlap.
 */

const fs = require('fs');
const path = require('path');

const MAX_TRADES_PER_PAIR = 200;
const MAX_TOTAL_TRADES = 1000;
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'trades-cache.json');
const SAVE_DEBOUNCE_MS = 2000; // Debounce file writes to avoid excessive I/O

class CantonUpdateStream {
  constructor() {
    this.initialized = false;
    // trades: Map<tradingPair, Map<tradeId, tradeRecord>>
    this.trades = new Map();
    this.totalTradeCount = 0;
    this._saveTimer = null;
  }

  async initialize() {
    // Load cached trades from disk
    this._loadFromFile();
    console.log(`[UpdateStream] Initialized — loaded ${this.totalTradeCount} trades from disk cache`);
    this.initialized = true;
  }

  addOrder() {}
  removeOrder() {}

  /**
   * Store a trade in the in-memory cache + persist to disk.
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

    console.log(`[UpdateStream] ✅ Cached trade ${tradeId} for ${pair} (total: ${this.totalTradeCount})`);

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

    // Persist to disk (debounced)
    this._debouncedSave();
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
    const pairStats = {};
    for (const [pair, trades] of this.trades.entries()) {
      pairStats[pair] = trades.size;
    }
    return {
      totalOrders: 0,
      totalTrades: this.totalTradeCount,
      pairs: [...this.trades.keys()],
      pairCounts: pairStats,
      initialized: this.initialized,
      cacheFile: CACHE_FILE,
      note: 'File-backed recent trades cache (survives restarts)'
    };
  }

  // ═══ File persistence ═══

  _debouncedSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveToFile(), SAVE_DEBOUNCE_MS);
  }

  _saveToFile() {
    try {
      // Ensure directory exists
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Serialize Map<pair, Map<tradeId, trade>> → JSON
      const data = {};
      for (const [pair, pairTrades] of this.trades.entries()) {
        data[pair] = [...pairTrades.values()];
      }

      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[UpdateStream] ⚠️ Failed to save trades cache: ${e.message}`);
    }
  }

  _loadFromFile() {
    try {
      if (!fs.existsSync(CACHE_FILE)) return;

      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);

      if (!data || typeof data !== 'object') return;

      let loaded = 0;
      for (const [pair, trades] of Object.entries(data)) {
        if (!Array.isArray(trades)) continue;
        const pairMap = new Map();
        for (const trade of trades) {
          if (trade && trade.tradeId) {
            pairMap.set(trade.tradeId, trade);
            loaded++;
          }
        }
        if (pairMap.size > 0) {
          this.trades.set(pair, pairMap);
        }
      }
      this.totalTradeCount = loaded;
    } catch (e) {
      console.warn(`[UpdateStream] ⚠️ Failed to load trades cache: ${e.message}`);
    }
  }

  stop() {
    // Flush any pending writes
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveToFile();
    }
  }
}

let instance = null;

function getUpdateStream() {
  if (!instance) {
    instance = new CantonUpdateStream();
  }
  return instance;
}

module.exports = { CantonUpdateStream, getUpdateStream };
