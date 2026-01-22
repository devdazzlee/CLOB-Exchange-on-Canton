/**
 * Database Service
 * Handles persistence of orders, trades, balances, and orderbook
 */

import { Pool, QueryResult } from 'pg';
import { config } from './config';

export interface OrderRow {
  order_id: string;
  party: string;
  market_id: string;
  side: string;
  price: number;
  quantity: number;
  remaining_qty: number;
  status: string;
  created_at: Date;
}

export interface TradeRow {
  trade_id: string;
  buyer: string;
  seller: string;
  market_id: string;
  price: number;
  quantity: number;
  timestamp: Date;
}

export class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
    });
  }

  async initialize() {
    // Create tables if they don't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        party TEXT NOT NULL,
        market_id TEXT NOT NULL,
        side TEXT NOT NULL,
        price DECIMAL NOT NULL,
        quantity DECIMAL NOT NULL,
        remaining_qty DECIMAL NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trades (
        trade_id TEXT PRIMARY KEY,
        buyer TEXT NOT NULL,
        seller TEXT NOT NULL,
        market_id TEXT NOT NULL,
        price DECIMAL NOT NULL,
        quantity DECIMAL NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        buy_order_id TEXT,
        sell_order_id TEXT
      );

      CREATE TABLE IF NOT EXISTS balances (
        party TEXT NOT NULL,
        instrument_id TEXT NOT NULL,
        amount DECIMAL NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (party, instrument_id)
      );

      CREATE TABLE IF NOT EXISTS orderbook_levels (
        market_id TEXT NOT NULL,
        side TEXT NOT NULL,
        price DECIMAL NOT NULL,
        quantity DECIMAL NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (market_id, side, price)
      );

      CREATE TABLE IF NOT EXISTS ledger_cursor (
        id INTEGER PRIMARY KEY DEFAULT 1,
        offset TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party);
      CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id);
      CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    `);
  }

  async upsertOrder(order: OrderRow) {
    await this.pool.query(
      `INSERT INTO orders (order_id, party, market_id, side, price, quantity, remaining_qty, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (order_id) DO UPDATE SET
         remaining_qty = EXCLUDED.remaining_qty,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        order.order_id,
        order.party,
        order.market_id,
        order.side,
        order.price,
        order.quantity,
        order.remaining_qty,
        order.status,
        order.created_at,
      ]
    );
  }

  async insertTrade(trade: TradeRow) {
    await this.pool.query(
      `INSERT INTO trades (trade_id, buyer, seller, market_id, price, quantity, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (trade_id) DO NOTHING`,
      [
        trade.trade_id,
        trade.buyer,
        trade.seller,
        trade.market_id,
        trade.price,
        trade.quantity,
        trade.timestamp,
      ]
    );
  }

  async getMarkets(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT market_id FROM orders ORDER BY market_id`
    );
    return result.rows.map((row) => row.market_id);
  }

  async getOrderBook(marketId: string): Promise<any> {
    const buyResult = await this.pool.query(
      `SELECT price, SUM(remaining_qty) as quantity
       FROM orders
       WHERE market_id = $1 AND side = 'BUY' AND status IN ('OPEN', 'PARTIALLY_FILLED')
       GROUP BY price
       ORDER BY price DESC
       LIMIT 20`,
      [marketId]
    );

    const sellResult = await this.pool.query(
      `SELECT price, SUM(remaining_qty) as quantity
       FROM orders
       WHERE market_id = $1 AND side = 'SELL' AND status IN ('OPEN', 'PARTIALLY_FILLED')
       GROUP BY price
       ORDER BY price ASC
       LIMIT 20`,
      [marketId]
    );

    return {
      bids: buyResult.rows,
      asks: sellResult.rows,
    };
  }

  async getTrades(marketId: string, limit: number): Promise<TradeRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM trades
       WHERE market_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [marketId, limit]
    );
    return result.rows;
  }

  async getOrdersByParty(party: string, status?: string): Promise<OrderRow[]> {
    let query = `SELECT * FROM orders WHERE party = $1`;
    const params: any[] = [party];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async getTradeHistory(party: string, limit: number): Promise<TradeRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM trades
       WHERE buyer = $1 OR seller = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [party, limit]
    );
    return result.rows;
  }

  getPool(): Pool {
    return this.pool;
  }

  async close() {
    await this.pool.end();
  }
}
