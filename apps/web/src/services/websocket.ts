/**
 * WebSocket Client Service (Frontend)
 * Connects to backend WebSocket for real-time updates
 */

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(WS_BASE_URL);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Resubscribe to all channels (components will resubscribe on their own)
      for (const channel of this.subscribers.keys()) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'subscribe',
            channel,
          }));
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }

  private handleMessage(message: any) {
    const { channel, data } = message;
    const subscribers = this.subscribers.get(channel);
    if (subscribers) {
      subscribers.forEach((callback) => callback(data));
    }
  }

  subscribe(channel: string, callback: (data: any) => void) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(callback);

    // Send subscribe message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel,
      }));
    }
  }

  unsubscribe(channel: string, callback: (data: any) => void) {
    const subscribers = this.subscribers.get(channel);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.subscribers.delete(channel);
        
        // Send unsubscribe message if connected
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'unsubscribe',
            channel,
          }));
        }
      }
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
  }
}

export const websocketClient = new WebSocketClient();
