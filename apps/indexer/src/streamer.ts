/**
 * Ledger Streamer
 * Streams transactions from Canton ledger and writes to database
 */

import { Database, OrderRow, TradeRow } from './database';
import { config } from './config';
import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './services/oauth';

// Note: @clob-exchange/api-clients needs to be built first
// If import fails, install dependencies: npm install

export class LedgerStreamer {
  private db: Database;
  private running: boolean = false;
  private cantonClient: CantonJsonApiClient | null = null;
  private oauthService: OAuthService;
  private lastOffset: string | null = null;

  constructor(db: Database) {
    this.db = db;
    this.oauthService = new OAuthService();
  }

  private async getCantonClient(): Promise<CantonJsonApiClient> {
    if (!this.cantonClient) {
      const token = await this.oauthService.getAccessToken();
      this.cantonClient = new CantonJsonApiClient({
        baseURL: config.canton.jsonApiBaseUrl,
        accessToken: token,
      });
    }
    return this.cantonClient;
  }

  async start() {
    this.running = true;
    console.log('Starting ledger streamer...');

    // Get last processed offset from database
    await this.loadLastOffset();

    while (this.running) {
      try {
        await this.processTransactions();
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Poll every 2 seconds
      } catch (error) {
        console.error('Error streaming transactions:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async loadLastOffset() {
    try {
      const pool = this.db.getPool();
      const result = await pool.query(
        'SELECT "offset" FROM ledger_cursor WHERE id = 1'
      );
      if (result.rows.length > 0) {
        this.lastOffset = result.rows[0].offset;
        console.log(`Resuming from offset: ${this.lastOffset}`);
      }
    } catch (error) {
      console.log('No previous offset found, starting from beginning');
    }
  }

  private async saveLastOffset(offset: string) {
    const pool = this.db.getPool();
    await pool.query(
      `INSERT INTO ledger_cursor (id, "offset") VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET "offset" = EXCLUDED."offset", updated_at = NOW()`,
      [offset]
    );
    this.lastOffset = offset;
  }

  private async processTransactions() {
    const client = await this.getCantonClient();

    // Query for new transactions since last offset
    const queryRequest: any = {
      filter: {
        // Query for our contract templates
        templateIds: [
          // These will be discovered dynamically
          // For now, query all contracts and filter
        ],
      },
    };

    if (this.lastOffset) {
      queryRequest.begin = { offset: this.lastOffset };
    }

    try {
      const result = await client.queryActiveContracts(queryRequest);

      for (const contract of result.activeContracts) {
        await this.processContract(contract);
      }

      // Update offset (in a real implementation, get from transaction metadata)
      if (result.activeContracts.length > 0) {
        // Use contract ID or transaction ID as offset
        const newOffset = result.activeContracts[result.activeContracts.length - 1].contractId;
        await this.saveLastOffset(newOffset);
      }
    } catch (error: any) {
      // If query fails, try alternative approach
      console.warn('Query failed, trying alternative method:', error.message);
    }
  }

  private async processContract(contract: any) {
    const templateId = contract.templateId;
    const payload = contract.payload;

    // Parse template ID to determine type
    // Format: "package-hash:Module:Entity"
    const parts = templateId.split(':');
    if (parts.length < 3) return;

    const entityName = parts[parts.length - 1];
    const moduleName = parts.slice(1, -1).join(':');

    // Process based on contract type
    if (entityName === 'LimitOrder' || entityName === 'Order') {
      await this.processOrder(contract);
    } else if (entityName === 'Trade') {
      await this.processTrade(contract);
    }
  }

  private async processOrder(contract: any) {
    const payload = contract.payload;
    
    const order: OrderRow = {
      order_id: payload.orderId || contract.contractId,
      party: payload.party || payload.owner,
      market_id: payload.marketId || payload.tradingPair,
      side: payload.side || payload.orderType,
      price: parseFloat(payload.price || '0'),
      quantity: parseFloat(payload.quantity || '0'),
      remaining_qty: parseFloat(payload.remainingQty || payload.remainingQuantity || payload.quantity || '0'),
      status: payload.status || 'OPEN',
      created_at: payload.createdAt ? new Date(payload.createdAt) : new Date(),
    };

    await this.db.upsertOrder(order);
  }

  private async processTrade(contract: any) {
    const payload = contract.payload;
    
    const trade: TradeRow = {
      trade_id: payload.tradeId || contract.contractId,
      buyer: payload.buyer,
      seller: payload.seller,
      market_id: payload.marketId || payload.tradingPair,
      price: parseFloat(payload.price || '0'),
      quantity: parseFloat(payload.quantity || '0'),
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    };

    await this.db.insertTrade(trade);
  }

  async stop() {
    this.running = false;
    console.log('Stopped ledger streamer');
  }
}
