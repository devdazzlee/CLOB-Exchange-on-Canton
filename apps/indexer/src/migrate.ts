/**
 * Database Migration Script
 * Creates all necessary tables using raw SQL (works with Prisma schema)
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL || '';

async function migrate() {
  console.log('Running database migrations...');
  
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in environment variables');
    console.error('Please set DATABASE_URL in .env file');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
  });
  
  try {
    // Create tables if they don't exist
    await pool.query(`
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
        "offset" TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party);
      CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id);
      CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    `);
    
    console.log('✅ Database migrations completed successfully');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
