/**
 * Canton Update Stream Service - PLACEHOLDER FOR COMPATIBILITY
 * 
 * This service is kept for backward compatibility but does NOT cache data.
 * All data should come DIRECTLY from Canton API.
 * 
 * For real-time updates, use Canton's WebSocket /v2/updates endpoint
 * (requires proper Canton deployment configuration)
 */

class CantonUpdateStream {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    console.log('[UpdateStream] NO CACHE MODE - All queries go directly to Canton API');
    this.initialized = true;
  }

  // These methods are kept for compatibility but return empty
  // Real data should come from Canton API directly
  addOrder() {}
  addTrade() {}
  removeOrder() {}
  
  getOrdersForPair() {
    return { buyOrders: [], sellOrders: [] };
  }
  
  getUserOrders() {
    return [];
  }
  
  getTradesForPair() {
    return [];
  }
  
  getAllTrades() {
    return [];
  }

  getStats() {
    return {
      totalOrders: 0,
      totalTrades: 0,
      initialized: this.initialized,
      note: 'NO CACHE - All data from Canton API directly'
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
