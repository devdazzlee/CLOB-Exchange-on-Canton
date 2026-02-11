/**
 * WebSocket Service — DISABLED (No-op Stub)
 * 
 * WebSocket does NOT work on Vercel serverless. All real-time updates
 * are handled via HTTP polling in TradingInterface.jsx:
 *   - Order book: polled every 3s
 *   - User orders: polled every 3s
 *   - Trades: polled every 5s
 *   - Balance: polled every 5s
 *   - Transfer offers: polled every 30s
 * 
 * This stub preserves the same API so existing imports don't break,
 * but every method is a silent no-op.
 */

class WebSocketService {
  constructor() {
      this._degraded = true;
      this.connectionFailed = true;
  }

  connect() { /* no-op */ }
  disconnect() { /* no-op */ }
  reconnect() { /* no-op */ }
  subscribe() { /* no-op */ }
  unsubscribe() { /* no-op */ }
  send() { /* no-op */ }
  isConnected() { return false; }
  
  get isDegraded() { return true; }
}

const websocketService = new WebSocketService();

export default websocketService;
export { WebSocketService };
