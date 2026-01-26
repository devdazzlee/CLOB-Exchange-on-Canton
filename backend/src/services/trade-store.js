/**
 * In-memory trade cache (best-effort)
 * Keeps the most recent trades to avoid heavy ledger queries.
 */

const MAX_TRADES_PER_PAIR = 500;
const MAX_TRADES_GLOBAL = 1000;

class TradeStore {
  constructor() {
    this.tradesByPair = new Map();
    this.allTrades = [];
  }

  addTrade(trade) {
    if (!trade || !trade.tradeId) return;

    const normalized = {
      ...trade,
      timestamp: trade.timestamp || new Date().toISOString(),
    };

    this.allTrades = [normalized, ...this.allTrades.filter((t) => t.tradeId !== normalized.tradeId)]
      .slice(0, MAX_TRADES_GLOBAL);

    if (normalized.tradingPair) {
      const current = this.tradesByPair.get(normalized.tradingPair) || [];
      const updated = [normalized, ...current.filter((t) => t.tradeId !== normalized.tradeId)]
        .slice(0, MAX_TRADES_PER_PAIR);
      this.tradesByPair.set(normalized.tradingPair, updated);
    }
  }

  getTrades(tradingPair, limit = 50) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 0) : 50;
    if (tradingPair) {
      return (this.tradesByPair.get(tradingPair) || []).slice(0, safeLimit);
    }
    return this.allTrades.slice(0, safeLimit);
  }

  getTradesForParty(partyId, limit = 100) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 0) : 100;
    if (!partyId) return [];
    return this.allTrades
      .filter((trade) => trade.buyer === partyId || trade.seller === partyId)
      .slice(0, safeLimit);
  }
}

module.exports = new TradeStore();
