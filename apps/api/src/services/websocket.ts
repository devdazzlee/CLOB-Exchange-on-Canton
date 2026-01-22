/**
 * WebSocket Service
 * Provides real-time updates for orderbook, trades, and balances
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface WebSocketMessage {
  channel: string;
  data: any;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocket>> = new Map();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.removeClient(ws);
        console.log('WebSocket client disconnected');
      });
    });

    console.log('WebSocket server initialized');
  }

  private handleMessage(ws: WebSocket, data: any) {
    if (data.type === 'subscribe') {
      const channel = data.channel;
      if (!this.clients.has(channel)) {
        this.clients.set(channel, new Set());
      }
      this.clients.get(channel)!.add(ws);
      console.log(`Client subscribed to ${channel}`);
    } else if (data.type === 'unsubscribe') {
      const channel = data.channel;
      this.clients.get(channel)?.delete(ws);
      console.log(`Client unsubscribed from ${channel}`);
    }
  }

  private removeClient(ws: WebSocket) {
    for (const [channel, clients] of this.clients.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.clients.delete(channel);
      }
    }
  }

  /**
   * Broadcast message to all clients subscribed to a channel
   */
  broadcast(channel: string, data: any) {
    const clients = this.clients.get(channel);
    if (!clients) return;

    const message = JSON.stringify({
      channel,
      data,
      timestamp: new Date().toISOString(),
    });

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Broadcast orderbook update
   */
  broadcastOrderBook(market: string, orderbook: any) {
    this.broadcast(`orderbook:${market}`, orderbook);
  }

  /**
   * Broadcast trade
   */
  broadcastTrade(market: string, trade: any) {
    this.broadcast(`trades:${market}`, trade);
  }

  /**
   * Broadcast balance update
   */
  broadcastBalance(party: string, balances: any) {
    this.broadcast(`balances:${party}`, balances);
  }
}

export const websocketService = new WebSocketService();
