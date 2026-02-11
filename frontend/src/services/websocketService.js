/**
 * WebSocket Service for Real-time Updates
 * Handles connections, subscriptions, and message routing
 */

class WebSocketService {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.subscribers = new Map(); // channel -> [callbacks]
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3; // Fail fast — switch to polling sooner
    this.reconnectDelay = 1000;    // Start at 1s, not 2s
    this.heartbeatInterval = null;
    this.isManualClose = false;
    this.connectionFailed = false; // Track persistent failure
  }

  connect() {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connected');
        return;
      }
      if (this.ws.readyState === WebSocket.CONNECTING) {
        console.log('[WebSocket] Already connecting');
        return;
      }
    }

    // Guard: don't attempt connection if URL is clearly invalid
    if (!this.url || this.url.includes('localhost') && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.warn('[WebSocket] Skipping connection — URL points to localhost but app is running remotely. Set VITE_WS_URL or VITE_BACKEND_URL.');
      this._degraded = true;
      return;
    }

    this.isManualClose = false;
    console.log(`[WebSocket] Connecting to ${this.url}...`);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this._degraded = false;
        this.startHeartbeat();
        // Resubscribe to all channels
        this.resubscribeAll();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        // Only log on first attempt to avoid console spam
        if (this.reconnectAttempts === 0) {
          console.error('[WebSocket] Error:', error);
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        
        if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.warn('[WebSocket] All reconnection attempts exhausted. Falling back to HTTP polling only.');
          this._degraded = true;
        } else {
          console.log('[WebSocket] Disconnected');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.reconnect();
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WebSocket] Max reconnection attempts reached — using HTTP polling only');
      this._degraded = true;
      this.connectionFailed = true;
      // Notify subscribers that connection has permanently failed
      this.subscribers.forEach((callbacks, channel) => {
        callbacks.forEach(cb => {
          try { cb({ type: 'WS_CONNECTION_FAILED' }); } catch (e) { /* ignore */ }
        });
      });
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s — capped at 5s (fast fail)
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 5000);
    
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Whether the service has given up on WebSocket and is in degraded (HTTP-only) mode
   */
  get isDegraded() {
    return this._degraded === true;
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 30000); // Send ping every 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  subscribe(channel, callback) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, []);
    }
    
    const callbacks = this.subscribers.get(channel);
    if (!callbacks.includes(callback)) {
      callbacks.push(callback);
    }

    // Send subscription message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'subscribe',
        channel: channel
      });
    }

    console.log(`[WebSocket] Subscribed to ${channel} (${callbacks.length} subscribers)`);
  }

  unsubscribe(channel, callback) {
    if (this.subscribers.has(channel)) {
      const callbacks = this.subscribers.get(channel);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
      
      // If no more subscribers, send unsubscribe message
      if (callbacks.length === 0) {
        this.subscribers.delete(channel);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({
            type: 'unsubscribe',
            channel: channel
          });
        }
      }
    }
  }

  resubscribeAll() {
    for (const channel of this.subscribers.keys()) {
      this.send({
        type: 'subscribe',
        channel: channel
      });
    }
  }

  handleMessage(message) {
    // Handle pong responses
    if (message.type === 'pong') {
      return;
    }

    const { channel, data, event } = message;
    
    // Route message to subscribers
    if (channel && this.subscribers.has(channel)) {
      this.subscribers.get(channel).forEach(callback => {
        try {
          callback(data || event || message);
        } catch (error) {
          console.error(`[WebSocket] Error in callback for ${channel}:`, error);
        }
      });
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send message - not connected');
    }
  }

  disconnect() {
    this.isManualClose = true;
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.subscribers.clear();
    console.log('[WebSocket] Disconnected');
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Create singleton instance
// WebSocket URL derivation priority:
// 1. VITE_WS_URL (explicit override)
// 2. VITE_BACKEND_URL (derive from backend URL)
// 3. VITE_API_BASE_URL (derive from API URL, strip /api suffix)
// 4. Same origin (production: use current page host)
// 5. localhost:3001 (development only)
//
// NOTE: On Vercel/serverless, WebSockets cannot work. The frontend will
// detect failure fast (3 attempts) and fall back to aggressive HTTP polling.
const getWebSocketUrl = () => {
  // 1. Explicit WS URL
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // 2. Derive from backend URL
  if (import.meta.env.VITE_BACKEND_URL) {
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    const wsProtocol = backendUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = backendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${wsProtocol}://${wsHost}/ws`;
  }

  // 3. Derive from API base URL (strip /api suffix)
  if (import.meta.env.VITE_API_BASE_URL) {
    const apiUrl = import.meta.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '');
    if (apiUrl && !apiUrl.startsWith('/')) {
      const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
      const wsHost = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `${wsProtocol}://${wsHost}/ws`;
    }
  }

  // 4. In production (not dev mode), use same origin
  if (!import.meta.env.DEV && typeof window !== 'undefined') {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${window.location.host}/ws`;
  }

  // 5. Development fallback — only used in local dev mode
  if (import.meta.env.DEV) {
    return 'ws://localhost:3001/ws';
  }

  // 6. Last resort — same origin (should never reach here)
  if (typeof window !== 'undefined') {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${window.location.host}/ws`;
  }

  return 'ws://localhost:3001/ws';
};

const WS_URL = getWebSocketUrl();
console.log(`[WebSocket] URL resolved to: ${WS_URL}`);
const websocketService = new WebSocketService(WS_URL);

export default websocketService;
export { WebSocketService };

