/**
 * WebSocket Service
 * Manages WebSocket connections and broadcasting
 */

const WebSocket = require('ws');
const config = require('../config');

class WebSocketService {
  constructor(server) {
    this.clients = new Map(); // clientId -> { ws, subscriptions: Set }
    this.wss = new WebSocket.Server({
      server,
      path: config.websocket.path,
      perMessageDeflate: config.websocket.perMessageDeflate,
    });

    this.setupEventHandlers();
    
    // Make clients available globally for health checks
    global.wsClients = this.clients;
  }

  setupEventHandlers() {
    this.wss.on('connection', (ws, req) => {
      const { v4: uuidv4 } = require('uuid');
      const clientId = uuidv4(); // PROPER UUID - no predictable IDs
      this.clients.set(clientId, { ws, subscriptions: new Set() });

      console.log(`[WebSocket] Client connected: ${clientId} (Total: ${this.clients.size})`);

      ws.on('message', (message) => {
        this.handleMessage(clientId, message);
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WebSocket] Client disconnected: ${clientId} (Total: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        console.error(`[WebSocket] Error for client ${clientId}:`, error);
      });

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });
  }

  handleMessage(clientId, message) {
    try {
      const data = JSON.parse(message);

      if (data.type === 'ping') {
        const client = this.clients.get(clientId);
        if (client) {
          client.ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      if (data.type === 'subscribe') {
        const { channel } = data;
        if (channel) {
          const client = this.clients.get(clientId);
          if (client) {
            client.subscriptions.add(channel);
            console.log(`[WebSocket] Client ${clientId} subscribed to ${channel}`);
            client.ws.send(JSON.stringify({ type: 'subscribed', channel }));
          }
        }
      }

      if (data.type === 'unsubscribe') {
        const { channel } = data;
        if (channel) {
          const client = this.clients.get(clientId);
          if (client) {
            client.subscriptions.delete(channel);
            console.log(`[WebSocket] Client ${clientId} unsubscribed from ${channel}`);
            client.ws.send(JSON.stringify({ type: 'unsubscribed', channel }));
          }
        }
      }
    } catch (error) {
      console.error('[WebSocket] Error handling message:', error);
    }
  }

  /**
   * Broadcast message to all clients subscribed to a channel
   */
  broadcast(channel, data) {
    const message = JSON.stringify({ type: 'update', channel, data });
    let sentCount = 0;

    this.clients.forEach((client, clientId) => {
      if (client.subscriptions.has(channel)) {
        try {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
            sentCount++;
          }
        } catch (error) {
          console.error(`[WebSocket] Error sending to client ${clientId}:`, error);
        }
      }
    });

    if (sentCount > 0) {
      console.log(`[WebSocket] Broadcasted to ${sentCount} client(s) on channel: ${channel}`);
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const channels = new Set();
    this.clients.forEach((client) => {
      if (client.subscriptions) {
        client.subscriptions.forEach((channel) => channels.add(channel));
      }
    });

    return {
      connected: this.clients.size,
      channels: Array.from(channels),
    };
  }
}

// Make broadcast function available globally for helpers
let wsServiceInstance = null;

function initializeWebSocketService(server) {
  wsServiceInstance = new WebSocketService(server);

  // Make broadcast available globally
  global.broadcastWebSocket = (channel, data) => {
    if (wsServiceInstance) {
      wsServiceInstance.broadcast(channel, data);
    }
  };

  return wsServiceInstance;
}

/**
 * Broadcast balance update for a specific party
 * Channel: balance:{partyId}
 */
function broadcastBalanceUpdate(partyId, balances, lockedBalances) {
  if (global.broadcastWebSocket) {
    global.broadcastWebSocket(`balance:${partyId}`, {
      type: 'BALANCE_UPDATE',
      partyId,
      balances,
      lockedBalances,
      timestamp: Date.now()
    });
  }
}

/**
 * Broadcast balance update to all users (for after trades)
 * Useful when multiple balances change at once
 */
function broadcastMultiBalanceUpdate(updates) {
  if (global.broadcastWebSocket) {
    updates.forEach(update => {
      broadcastBalanceUpdate(update.partyId, update.balances, update.lockedBalances);
    });
  }
}

module.exports = {
  WebSocketService,
  initializeWebSocketService,
  broadcastBalanceUpdate,
  broadcastMultiBalanceUpdate,
};
