/**
 * Balance Service
 * Queries token-standard holdings for party balances
 */

import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { ScanApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './oauth';
import { config } from '../config';

export interface Balance {
  instrumentId: string;
  amount: string;
  contractId?: string;
}

export class BalanceService {
  private oauthService: OAuthService;
  private cantonClient: CantonJsonApiClient | null = null;
  private scanClient: ScanApiClient;

  constructor() {
    this.oauthService = new OAuthService();
    this.scanClient = new ScanApiClient({
      baseURL: config.scan.baseUrl,
      prefix: config.scan.prefix,
    });
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

  /**
   * Get balances for a party
   * Queries token-standard holdings
   */
  async getBalances(party: string): Promise<Balance[]> {
    const client = await this.getCantonClient();

    // Query for holdings contracts
    // TODO: Discover actual template ID for Token Standard holdings
    const result = await client.queryActiveContracts({
      filter: {
        party: party,
        // templateIds: ['holding-template-id'], // To be discovered
      },
    });

    const balances: Balance[] = [];

    for (const contract of result.activeContracts) {
      // Parse holding contract to extract instrument ID and amount
      // Structure depends on Token Standard
      const payload = contract.payload;
      
      // Try common field names
      const instrumentId = payload.instrumentId || payload.instrument || payload.tokenId;
      const amount = payload.amount || payload.quantity || payload.balance;

      if (instrumentId && amount) {
        balances.push({
          instrumentId: String(instrumentId),
          amount: String(amount),
          contractId: contract.contractId,
        });
      }
    }

    return balances;
  }

  /**
   * Get balance for specific instrument
   */
  async getBalance(party: string, instrumentId: string): Promise<Balance | null> {
    const balances = await this.getBalances(party);
    return balances.find((b) => b.instrumentId === instrumentId) || null;
  }
}
