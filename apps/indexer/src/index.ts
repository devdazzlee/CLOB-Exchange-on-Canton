/**
 * Indexer Service
 * Streams ledger transactions and materializes to database
 */

import express from 'express';
import { config } from './config';
import { Database } from './database';
import { LedgerStreamer } from './streamer';

class IndexerService {
  private db: Database;
  private streamer: LedgerStreamer;
  private app: express.Application;

  constructor() {
    this.db = new Database();
    this.streamer = new LedgerStreamer(this.db);
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.use(express.json());
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // REST endpoints
    this.app.get('/markets', async (req, res) => {
      try {
        const markets = await this.db.getMarkets();
        res.json({ markets });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/orderbook', async (req, res) => {
      try {
        const { market } = req.query;
        if (!market) {
          return res.status(400).json({ error: 'market parameter required' });
        }
        const orderbook = await this.db.getOrderBook(market as string);
        res.json({ orderbook });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/trades', async (req, res) => {
      try {
        const { market, limit = '100' } = req.query;
        const trades = await this.db.getTrades(market as string, parseInt(limit as string));
        res.json({ trades });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/me/orders', async (req, res) => {
      try {
        const { party, status } = req.query;
        if (!party) {
          return res.status(400).json({ error: 'party parameter required' });
        }
        const orders = await this.db.getOrdersByParty(party as string, status as string);
        res.json({ orders });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/me/history', async (req, res) => {
      try {
        const { party, limit = '100' } = req.query;
        if (!party) {
          return res.status(400).json({ error: 'party parameter required' });
        }
        const history = await this.db.getTradeHistory(party as string, parseInt(limit as string));
        res.json({ history });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  async start() {
    console.log('Starting Indexer Service...');

    // Initialize database
    await this.db.initialize();

    // Start streaming
    await this.streamer.start();

    // Start HTTP server
    const PORT = parseInt(process.env.INDEXER_PORT || '3002', 10);
    this.app.listen(PORT, () => {
      console.log(`Indexer API running on port ${PORT}`);
    });

    console.log('Indexer Service started');
  }

  async stop() {
    console.log('Stopping Indexer Service...');
    await this.streamer.stop();
    await this.db.close();
  }
}

const indexer = new IndexerService();
indexer.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  indexer.stop().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  indexer.stop().then(() => process.exit(0));
});
