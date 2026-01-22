/**
 * External Party Service
 * Implements Digital Asset "Create an External Party (Wallet)" flow
 */

import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './oauth';
import { config } from '../config';
// Note: Signing should happen on frontend
// This is a placeholder for backend structure
// import { signMessage } from '@clob-exchange/crypto';

export interface ExternalPartyRequest {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  partyHint?: string;
}

export class ExternalPartyService {
  private oauthService: OAuthService;
  private cantonClient: CantonJsonApiClient | null = null;

  constructor() {
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

  /**
   * Generate external party using Wallet SDK flow
   * 1. generateExternalParty(publicKey, optional partyHint)
   * 2. sign multiHash with private key
   * 3. allocateExternalParty(signature, preparedParty)
   */
  async allocateExternalParty(request: ExternalPartyRequest): Promise<string> {
    const client = await this.getCantonClient();

    // Step 1: Prepare party allocation
    // This would typically call a prepare endpoint first
    // For now, we'll construct the command directly

    // Step 2: Create multiHash to sign
    // The multiHash is typically: hash(publicKey + partyHint + timestamp)
    const publicKeyBase64 = Buffer.from(request.publicKey).toString('base64');
    const hashInput = `${publicKeyBase64}${request.partyHint || ''}${Date.now()}`;
    const hashBuffer = Buffer.from(hashInput);
    
    // Step 3: Sign the hash
    // Note: Signing should happen on frontend for security
    // Backend receives the signature from frontend
    // For now, placeholder - frontend will send signature
    const signatureBase64 = ''; // Will be provided by frontend

    // Step 4: Allocate external party
    // NOTE: This service is deprecated - use OnboardingService.allocateExternalParty instead
    // which uses the proper /v2/parties/external/* endpoints
    throw new Error('Use OnboardingService.allocateExternalParty instead - this method is deprecated');
  }

  /**
   * Ping transaction to verify party allocation
   * Uses prepareSubmission -> sign -> executeSubmissionAndWait
   */
  async pingTransaction(partyId: string, privateKey: Uint8Array): Promise<void> {
    const client = await this.getCantonClient();

    // Prepare submission
    // TODO: Use actual prepare endpoint
    const prepareRequest = {
      commands: [{
        templateId: '', // To be discovered
        choice: 'Ping', // To be discovered
        argument: {},
      }],
      actAs: [partyId],
    };

    // In a real implementation:
    // 1. Call prepareSubmission endpoint
    // 2. Get preparedTransactionHash
    // 3. Sign the hash
    // 4. Call executeSubmissionAndWait with signature

    // TODO: Implement proper ping transaction with v2 command structure
    // For now, this is a placeholder - ping transactions need proper template discovery
    // await client.submitAndWait({
    //   applicationId: 'clob-exchange-api',
    //   commandId: crypto.randomUUID(),
    //   actAs: [partyId],
    //   commands: [{
    //     exercise: {
    //       templateId: { packageId: '', moduleName: '', entityName: '' },
    //       contractId: '',
    //       choice: 'Ping',
    //       argument: {},
    //     },
    //   }],
    // });
    console.log('[ExternalParty] Ping transaction placeholder - needs template discovery');
  }
}
