/**
 * Canton JSON API Client
 * Based on documented API structure from Digital Asset
 * TODO: Replace with generated client once OpenAPI spec is available
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

export interface CantonConfig {
  baseURL: string;
  accessToken: string;
}

export interface Party {
  party: string;
  displayName?: string;
  isLocal?: boolean;
}

// V2 Command structures
export interface V2CreateCommand {
  create: {
    templateId: {
      packageId: string;
      moduleName: string;
      entityName: string;
    };
    payload: Record<string, any>;
  };
}

export interface V2ExerciseCommand {
  exercise: {
    templateId: {
      packageId: string;
      moduleName: string;
      entityName: string;
    };
    contractId: string;
    choice: string;
    argument: Record<string, any>;
  };
}

export interface V2SubmitRequest {
  applicationId: string;
  commandId: string;
  actAs: string[];
  readAs?: string[];
  commands: Array<V2CreateCommand | V2ExerciseCommand>;
  deduplicationPeriod?: {
    duration: string;
  };
  minLedgerTimeAbs?: string;
  minLedgerTimeRel?: string;
}

export interface V2SubmitResponse {
  transaction: {
    transactionId: string;
    effectiveAt: string;
    events: any[];
  };
}

// External Party Allocation types
export interface GenerateTopologyRequest {
  synchronizer: string; // Required: synchronizer ID as string (e.g., "global-domain::1220...")
  partyHint?: string;
  publicKey: {
    format: string; // e.g., "CRYPTO_KEY_FORMAT_RAW" or "CRYPTO_KEY_FORMAT_DER_X509_SUBJECT_PUBLIC_KEY_INFO"
    keyData: string; // base64 encoded
    keySpec: string; // e.g., "SIGNING_KEY_SPEC_EC_CURVE25519"
  };
  permission?: string; // e.g., "Confirmation" — ensures external party can confirm/sign transactions
}

export interface GenerateTopologyResponse {
  partyId?: string; // Canton returns this
  party?: string; // Alternative field name
  externalParty?: string; // Alternative field name
  topologyTransactions?: string[]; // Canton returns this (actual field name)
  onboardingTransactions?: string[]; // Alias for backward compatibility
  onboarding_transactions?: string[]; // Alternative field name (snake_case)
  transactions?: string[]; // Alternative field name
  onboardingTxs?: string[]; // Alternative field name
  multiHash?: string; // base64 encoded hash to sign
  multi_hash?: string; // Alternative field name (snake_case)
  publicKeyFingerprint?: string; // Canton may return this
}

// Connected Synchronizers types
export interface ConnectedSynchronizer {
  synchronizerId: string;
  synchronizerAlias?: string; // Actual field name from API
  alias?: string; // Legacy/alternative field name
  domainId?: string;
  permission?: string; // API may return permission field
}

export interface ConnectedSynchronizersResponse {
  connectedSynchronizers: ConnectedSynchronizer[];
}

export interface AllocateExternalPartyRequest {
  synchronizer?: string; // Optional: synchronizer ID as string
  partyId?: string; // Optional: party ID if provided
  topologyTransactions: string[]; // Canton expects this field name
  multiHashSignatures: Array<{
    publicKey: {
      format: string;
      keyData: string;
      keySpec: string;
    };
    signature: string; // base64 encoded signature
  }>;
}

export interface AllocateExternalPartyResponse {
  party: string;
}

// Legacy v1 structures (for backward compatibility)
export interface Command {
  templateId?: string;
  interfaceId?: string;
  choice: string;
  argument: Record<string, any>;
  meta?: {
    contractKey?: Record<string, any>;
    disclosedContracts?: string[];
    choiceContextData?: Record<string, any>;
  };
}

export interface SubmitRequest {
  commands: Command[];
  readAs?: string[];
  actAs?: string[];
  workflowId?: string;
  commandId?: string;
  deduplicationPeriod?: {
    duration: string;
  };
  minLedgerTimeAbs?: string;
  minLedgerTimeRel?: string;
}

export interface SubmitResponse {
  transaction: {
    transactionId: string;
    effectiveAt: string;
    events: any[];
  };
}

export interface ActiveContract {
  contractId: string;
  templateId: string;
  payload: Record<string, any>;
  signatories: string[];
  observers: string[];
  key?: Record<string, any>;
}

export interface QueryRequest {
  filter: {
    templateIds?: string[];
    interfaceIds?: string[];
    party?: string;
  };
  begin?: {
    offset?: string;
  };
  end?: {
    offset?: string;
  };
}

export class CantonJsonApiClient {
  private client: AxiosInstance;
  private applicationId: string;

  constructor(config: CantonConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    this.applicationId = 'clob-exchange-api';
  }

  /**
   * Submit v2 command and wait for completion
   * Requires: applicationId, commandId, actAs, and typed commands
   */
  async submitAndWait(request: V2SubmitRequest): Promise<V2SubmitResponse> {
    const response = await this.client.post('/v2/commands/submit-and-wait', request);
    return response.data;
  }

  /**
   * Generate topology for external party allocation
   * Step 1 of external party onboarding
   */
  async generateExternalPartyTopology(
    request: GenerateTopologyRequest
  ): Promise<GenerateTopologyResponse> {
    const response = await this.client.post(
      '/v2/parties/external/generate-topology',
      request
    );
    return response.data;
  }

  /**
   * Allocate external party with signed transactions
   * Step 2 of external party onboarding
   */
  async allocateExternalParty(
    request: AllocateExternalPartyRequest
  ): Promise<AllocateExternalPartyResponse> {
    // Validate request structure before sending
    if (!request.topologyTransactions || !Array.isArray(request.topologyTransactions)) {
      throw new Error('topologyTransactions is required and must be an array');
    }
    
    if (!request.multiHashSignatures || !Array.isArray(request.multiHashSignatures) || request.multiHashSignatures.length === 0) {
      throw new Error('multiHashSignatures is required and must be a non-empty array');
    }
    
    // Validate each signature's publicKey structure
    for (const sig of request.multiHashSignatures) {
      if (!sig.publicKey || typeof sig.publicKey !== 'object') {
        throw new Error('multiHashSignatures[].publicKey must be an object');
      }
      if (!sig.publicKey.format || typeof sig.publicKey.format !== 'string') {
        throw new Error('multiHashSignatures[].publicKey.format is required and must be a string');
      }
      if (!sig.publicKey.keyData || typeof sig.publicKey.keyData !== 'string') {
        throw new Error('multiHashSignatures[].publicKey.keyData is required and must be a string');
      }
      if (!sig.publicKey.keySpec || typeof sig.publicKey.keySpec !== 'string') {
        throw new Error('multiHashSignatures[].publicKey.keySpec is required and must be a string');
      }
      if (!sig.signature || typeof sig.signature !== 'string') {
        throw new Error('multiHashSignatures[].signature is required and must be a string');
      }
    }
    
    // Log full request for debugging (sanitize sensitive data)
    console.log('[CantonJsonApiClient] allocateExternalParty request:', JSON.stringify({
      synchronizer: request.synchronizer,
      topologyTransactionsCount: request.topologyTransactions.length,
      multiHashSignatures: request.multiHashSignatures.map(sig => ({
        publicKey: {
          format: sig.publicKey.format,
          keyData: sig.publicKey.keyData.substring(0, 20) + '...',
          keySpec: sig.publicKey.keySpec,
        },
        signature: sig.signature.substring(0, 20) + '...',
      })),
    }, null, 2));
    
    const response = await this.client.post(
      '/v2/parties/external/allocate',
      request
    );
    return response.data;
  }

  /**
   * Query active contracts
   */
  async queryActiveContracts(request: QueryRequest): Promise<{ activeContracts: ActiveContract[] }> {
    const response = await this.client.post('/v2/state/active-contracts', request);
    return response.data;
  }

  /**
   * Get parties
   */
  async getParties(): Promise<{ result: Party[] }> {
    const response = await this.client.get('/v2/parties');
    return response.data;
  }

  /**
   * Get party by ID
   */
  async getParty(partyId: string): Promise<Party> {
    const response = await this.client.get(`/v2/parties/${encodeURIComponent(partyId)}`);
    return response.data;
  }

  /**
   * Get connected synchronizers
   * Returns list of synchronizers that the participant is connected to
   */
  async getConnectedSynchronizers(): Promise<ConnectedSynchronizersResponse> {
    const response = await this.client.get('/v2/state/connected-synchronizers');
    return response.data;
  }

  /**
   * Get global synchronizer ID
   * Fetches connected synchronizers and returns the "global" one, or the first one if no global
   */
  async getGlobalSynchronizerId(): Promise<string> {
    const response = await this.getConnectedSynchronizers();
    const synchronizers = response.connectedSynchronizers || [];
    
    if (synchronizers.length === 0) {
      throw new Error('No connected synchronizers found');
    }

    // Try to find one with synchronizerAlias "global" (actual API field name)
    const globalSync = synchronizers.find(s => 
      s.synchronizerAlias === 'global' || s.alias === 'global'
    );
    if (globalSync) {
      return globalSync.synchronizerId;
    }

    // Prefer one containing "global-domain" in the ID
    const globalDomainSync = synchronizers.find(s => 
      s.synchronizerId.includes('global-domain')
    );
    if (globalDomainSync) {
      return globalDomainSync.synchronizerId;
    }

    // Fallback to first synchronizer
    if (!synchronizers[0]?.synchronizerId) {
      throw new Error(
        `Could not extract synchronizerId from response: ${JSON.stringify(response)}`
      );
    }

    return synchronizers[0].synchronizerId;
  }
}
