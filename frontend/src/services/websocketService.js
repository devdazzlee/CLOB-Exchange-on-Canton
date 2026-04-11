/**
 * WebSocket Service — Pure Real-time Updates (No Polling)
 * 
 * Connects to the backend WebSocket server at /ws for instant push updates:
 *   - Order book changes (ORDER_CREATED, ORDER_ARCHIVED, FULL_ORDERBOOK)
 *   - New trades (NEW_TRADE)
 *   - User orders (ORDER_CREATED, ORDER_FILLED, ORDER_CANCELLED, ORDERS_SNAPSHOT)
 *   - Balance updates (BALANCE_UPDATE)
 *   - Transfer offers (TRANSFER_CREATED, TRANSFER_ACCEPTED, TRANSFER_REJECTED)
 *   - Ledger state changes (LEDGER_UPDATE)
 * 
 * NO polling fallback — all data streams via WebSocket with auto-reconnect.
 * Initial data is loaded via one-time REST calls; all subsequent updates
 * are pushed through this WebSocket connection.
 * 
 * The backend's streaming read model (streamingReadModel.js) emits
 * events from Canton's /v2/updates WebSocket and broadcasts them
 * via websocketService.js → global.broadcastWebSocket to all
 * subscribed frontend clients.
 */

const RECONNECT_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 25000;

class WebSocketService {
  constructor() {
    this._ws = null;
    this._degraded = true;
    this.connectionFailed = true;
    this._callbacks = new Map(); // channel → Set<callback>
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._url = null;
    this._manualDisconnect = false;
  }

  /**
   * Build the WebSocket URL from the current page location
   */
  _buildUrl() {
    if (this._url) return this._url;
    
    // In development, connect to backend directly
    const apiBase = import.meta.env.VITE_API_BASE_URL || 
      (import.meta.env.DEV ? 'http://localhost:3001' : '');
    
    if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
      const parsed = new URL(apiBase);
      const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      this._url = `${protocol}//${parsed.host}/ws`;
    } else {
      // Relative URL — use current page's host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this._url = `${protocol}//${window.location.host}/ws`;
    }
    
    return this._url;
  }

  /**
   * Connect to the WebSocket server
   */
  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return; // Already connected or connecting
    }

    this._manualDisconnect = false;
    
    try {
      const url = this._buildUrl();
      console.log(`[WS] Connecting to ${url}...`);
      this._ws = new WebSocket(url);

      this._ws.onopen = () => {
        console.log('[WS] Connected');
        this._degraded = false;
        this.connectionFailed = false;
        this._reconnectAttempts = 0;

        // Re-subscribe to all active channels
        for (const channel of this._callbacks.keys()) {
          this._sendSubscribe(channel);
        }

        // Start heartbeat
        this._startHeartbeat();
      };

      this._ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'pong') return;
          if (msg.type === 'connected') {
            console.log(`[WS] Assigned client ID: ${msg.clientId}`);
            return;
          }
          if (msg.type === 'subscribed') return;
          if (msg.type === 'unsubscribed') return;
          
          // Broadcast update to channel subscribers
          if (msg.type === 'update' && msg.channel) {
            const callbacks = this._callbacks.get(msg.channel);
            if (callbacks) {
              for (const cb of callbacks) {
                try { cb(msg.data); } catch (e) { /* subscriber error */ }
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      this._ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code})`);
        this._degraded = true;
        this._stopHeartbeat();
        
        if (!this._manualDisconnect) {
          this._scheduleReconnect();
        }
      };

      this._ws.onerror = (error) => {
        console.warn('[WS] Connection error');
        this.connectionFailed = true;
        this._degraded = true;
      };
    } catch (err) {
      console.warn('[WS] Failed to create WebSocket:', err.message);
      this.connectionFailed = true;
      this._degraded = true;
      this._scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect() {
    this._manualDisconnect = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._degraded = true;
  }

  /**
   * Force reconnect
   */
  reconnect() {
    this.disconnect();
    this._manualDisconnect = false;
    this._reconnectAttempts = 0;
    setTimeout(() => this.connect(), 100);
  }

  /**
   * Subscribe to a channel
   * @param {string} channel - Channel name (e.g., 'orderbook:BTC/USDT', 'trades:all')
   * @param {Function} callback - Called with data when an update arrives
   */
  subscribe(channel, callback) {
    if (!this._callbacks.has(channel)) {
      this._callbacks.set(channel, new Set());
    }
    this._callbacks.get(channel).add(callback);

    // If already connected, send subscribe message
    if (this.isConnected()) {
      this._sendSubscribe(channel);
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel, callback) {
    const callbacks = this._callbacks.get(channel);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this._callbacks.delete(channel);
        // Send unsubscribe to server
        if (this.isConnected()) {
          this._send({ type: 'unsubscribe', channel });
        }
      }
    }
  }

  /**
   * Send raw data
   */
  send(data) {
    this._send(data);
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  get isDegraded() {
    return this._degraded;
  }

  // ─── Internal ──────────────────────────────────────────────────────

  _send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  _sendSubscribe(channel) {
    this._send({ type: 'subscribe', channel });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this._send({ type: 'ping' });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    
    this._reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_DELAY_MS * Math.pow(1.5, this._reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );
    
    console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempts})...`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

const websocketService = new WebSocketService();

export default websocketService;
export { WebSocketService };
