/**
 * Matching Engine
 * Subscribes to ledger events and matches orders
 */

import { config } from './config';
import { OrderBook } from './orderbook';
import { MatchingEngine } from './engine';

class MatcherService {
  private orderBooks: Map<string, OrderBook> = new Map();
  private engine: MatchingEngine;

  constructor() {
    this.engine = new MatchingEngine();
  }

  async start() {
    console.log('Starting Matching Engine...');
    
    // TODO: Subscribe to ledger events via gRPC
    // For now, placeholder structure
    
    // Subscribe to order creation events
    // When new order is created, add to order book and try to match
    
    console.log('Matching Engine started');
  }

  async stop() {
    console.log('Stopping Matching Engine...');
  }
}

const matcher = new MatcherService();
matcher.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  matcher.stop().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  matcher.stop().then(() => process.exit(0));
});
