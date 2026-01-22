/**
 * Faucet Service
 * Handles test fund allocation using Token Standard factory workflow
 */

import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { ScanApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './oauth';
import { config } from '../config';

export interface FaucetRequest {
  party: string;
  instrumentId: string;
  amount?: string;
}

export class FaucetService {
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
   * Get test funds using Token Standard factory
   */
  async getTestFunds(request: FaucetRequest): Promise<void> {
    const client = await this.getCantonClient();

    // 1. Fetch instrument registry to get factory contract
    const instrument = await this.scanClient.getInstrument(request.instrumentId);

    if (!instrument.transferFactory && !instrument.allocationFactory) {
      throw new Error(`No factory found for instrument ${request.instrumentId}`);
    }

    // 2. Use TransferFactory or AllocationFactory
    const factory = instrument.transferFactory || instrument.allocationFactory;
    if (!factory) {
      throw new Error('Factory not available');
    }

    // 3. Exercise factory choice
    // TODO: Discover the actual choice name (e.g., "Allocate", "Transfer", "Mint")
    // For now, placeholder structure
    // TODO: Convert to v2 command structure once template IDs are discovered
    // For now, this is a placeholder - needs proper template discovery
    // const command: V2ExerciseCommand = {
    //   exercise: {
    //     templateId: {
    //       packageId: '',
    //       moduleName: '',
    //       entityName: '',
    //     },
    //     contractId: factory.contractId,
    //     choice: 'Allocate',
    //     argument: {
    //       recipient: request.party,
    //       amount: request.amount || '1000.0',
    //     },
    //   },
    // };
    
    // await client.submitAndWait({
    //   applicationId: 'clob-exchange-api',
    //   commandId: crypto.randomUUID(),
    //   actAs: [request.party],
    //   commands: [command],
    // });
    
    throw new Error('Faucet functionality requires template discovery - not yet implemented');
  }

  /**
   * Get available instruments for faucet
   */
  async getAvailableInstruments(): Promise<any[]> {
    const instruments = await this.scanClient.queryInstruments();
    return instruments.filter((inst) => inst.transferFactory || inst.allocationFactory);
  }
}
