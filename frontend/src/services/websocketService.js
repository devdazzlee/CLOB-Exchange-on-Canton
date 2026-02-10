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
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.isManualClose = false;
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
      console.warn('[WebSocket] Max reconnection attempts reached. Real-time updates unavailable — using HTTP polling.');
      this._degraded = true;
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with cap at 30s
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
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
// WebSocket URL from environment or derived from current page location
const getWebSocketUrl = () => {
  // 1. Explicit WS URL from environment (highest priority)
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // 2. Derive from explicit backend URL if provided
  if (import.meta.env.VITE_BACKEND_URL) {
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    const wsProtocol = backendUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = backendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${wsProtocol}://${wsHost}/ws`;
  }

  // 3. Development mode → localhost
  if (import.meta.env.DEV) {
    return 'ws://localhost:3001/ws';
  }

  // 4. Production fallback → derive from current page location (same-origin)
  //    This is consistent with how API_BASE_URL falls back to '/api' in production.
  if (typeof window !== 'undefined') {
    const loc = window.location;
    const wsProtocol = loc.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${loc.host}/ws`;
  }

  // 5. Absolute last resort (should never reach here in a browser)
  return 'wss://localhost:3001/ws';
};

const WS_URL = getWebSocketUrl();
const websocketService = new WebSocketService(WS_URL);

// Auto-connect on import (can be disabled if needed)
// websocketService.connect();

export default websocketService;
export { WebSocketService };

