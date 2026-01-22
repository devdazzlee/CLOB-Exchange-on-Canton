/**
 * Onboarding Service
 * Handles external party allocation and transfer preapproval creation
 */

import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { ScanApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './oauth';
import { config } from '../config';
import crypto from 'crypto';
import { signMessage } from '@clob-exchange/crypto';

export interface AllocatePartyRequest {
  publicKey: string; // base64 encoded Ed25519 public key
  partyHint?: string; // Optional - will be derived from publicKey if missing
  signature?: string; // base64 encoded signature (for step 2)
  onboardingTransactions?: string[]; // Required when signature is provided (from step 1) - alias
  topologyTransactions?: string[]; // Alternative field name (Canton's actual field name)
  partyId?: string; // Optional: party ID from Step 1 (if Canton provided it)
}

export interface AllocatePartyResponse {
  step: 'TOPOLOGY' | 'ALLOCATED'; // Indicates which step completed
  partyId?: string; // May be present in Step 1 (if Canton provides it), always in Step 2
  partyHint: string; // The party hint that was used
  synchronizerId: string; // The synchronizer ID that was used
  multiHash?: string; // Only present in Step 1 (TOPOLOGY)
  onboardingTransactions?: string[]; // Only present in Step 1 (TOPOLOGY) - alias for backward compatibility
  topologyTransactions?: string[]; // Only present in Step 1 (TOPOLOGY) - Canton's actual field name
}

interface CachedSynchronizer {
  synchronizerId: string;
  expiresAt: number;
}

export class OnboardingService {
  private oauthService: OAuthService;
  private cantonClient: CantonJsonApiClient | null = null;
  private scanClient: ScanApiClient;
  private cachedSynchronizer: CachedSynchronizer | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.oauthService = new OAuthService();
    this.scanClient = new ScanApiClient({
      baseURL: config.scan.baseUrl,
      prefix: config.scan.prefix,
    });
  }

  /**
   * Initialize Canton client with OAuth token
   */
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
   * Sanitize party hint
   * - Trims whitespace
   * - Replaces invalid chars with "-"
   * - Collapses multiple "-"
   * - Limits to 64 chars
   * - Removes leading/trailing "-"
   */
  private sanitizePartyHint(input: string): string {
    return input
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64)
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Derive deterministic party hint from public key
   * Format: ext-<first12hex-of-sha256(publicKeyBase64)>
   * This ensures the same public key always gets the same hint
   */
  private derivePartyHint(publicKeyBase64: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(publicKeyBase64)
      .digest('hex')
      .slice(0, 12);
    return `ext-${hash}`;
  }

  /**
   * Get or generate party hint
   * If provided, sanitizes it. If empty after sanitization, derives from publicKey
   */
  private getOrGeneratePartyHint(publicKeyBase64: string, providedHint?: string): string {
    if (providedHint) {
      const sanitized = this.sanitizePartyHint(providedHint);
      if (sanitized.length > 0) {
        return sanitized;
      }
    }
    // Derive deterministic hint from public key
    return this.derivePartyHint(publicKeyBase64);
  }

  /**
   * Get synchronizer ID
   * Tries env var first, then fetches from API if not set
   * Caches result for 5 minutes to avoid repeated API calls
   */
  private async getSynchronizerId(): Promise<string> {
    // Check env var first (manual override)
    if (config.canton.synchronizerId) {
      return config.canton.synchronizerId;
    }

    // Use cached value if available and not expired
    const now = Date.now();
    if (this.cachedSynchronizer && this.cachedSynchronizer.expiresAt > now) {
      return this.cachedSynchronizer.synchronizerId;
    }

    // Fetch from API
    console.log('[Onboarding] Fetching synchronizer ID from API...');
    const client = await this.getCantonClient();
    try {
      const synchronizerId = await client.getGlobalSynchronizerId();
      
      // Cache for 5 minutes
      this.cachedSynchronizer = {
        synchronizerId,
        expiresAt: now + this.CACHE_TTL_MS,
      };
      
      console.log(`[Onboarding] Found synchronizer ID: ${synchronizerId.substring(0, 20)}...`);
      return synchronizerId;
    } catch (error: any) {
      throw new Error(
        `Failed to get synchronizer ID: ${error.message}. ` +
        `Either set CANTON_SYNCHRONIZER_ID in .env or ensure the participant has connected synchronizers.`
      );
    }
  }

  /**
   * Allocate external party using 2-step flow
   * 
   * Step 1 (no signature): Generate topology, return multiHash + onboardingTransactions
   * Step 2 (with signature): Use provided onboardingTransactions, call allocate endpoint
   * 
   * Frontend flow:
   * 1) call allocate-party (no signature) -> get multiHash + onboardingTransactions
   * 2) sign multiHash client-side
   * 3) call allocate-party again with signature + onboardingTransactions
   * 4) call ensure-rights and create-preapproval with {party: partyId}
   */
  async allocateExternalParty(
    request: AllocatePartyRequest
  ): Promise<AllocatePartyResponse> {
    const client = await this.getCantonClient();

    // Get synchronizer ID (from env or fetch from API)
    const synchronizerId = await this.getSynchronizerId();
    
    // Build publicKey object (same format for both steps)
    // Use plain strings (not const assertions) to ensure proper JSON serialization
    const publicKeyObj = {
      format: String('CRYPTO_KEY_FORMAT_RAW'),
      keyData: String(request.publicKey), // base64 encoded string
      keySpec: String('SIGNING_KEY_SPEC_EC_CURVE25519'),
    };

    // Step 2: If signature is provided, allocate directly (do NOT regenerate topology)
    if (request.signature) {
      // Accept onboardingTransactions OR topologyTransactions (normalize to txs)
      const txs = request.onboardingTransactions || request.topologyTransactions;
      
      if (!txs || !Array.isArray(txs) || txs.length === 0) {
        throw new Error(
          'onboardingTransactions or topologyTransactions is required when signature is provided. ' +
          'Use the onboardingTransactions from Step 1 response.'
        );
      }

      console.log('[Onboarding] Step 2: Allocating external party with provided signature...');
      console.log(`[Onboarding] Synchronizer: ${synchronizerId.substring(0, 20)}...`);
      console.log(`[Onboarding] Transactions count: ${txs.length}`);
      console.log(`[Onboarding] Public key: ${request.publicKey.substring(0, 20)}...`);
      console.log(`[Onboarding] Using same publicKey from Step 1 (not regenerating topology)`);
      
      // Use the transactions from Step 1 (do NOT regenerate topology)
      // IMPORTANT: Build publicKey object ALWAYS from request.publicKey (base64 string)
      // NEVER accept a publicKey object from UI that could override the shape
      // Use String() to ensure proper serialization (not const assertions)
      const publicKeyForAllocate = {
        format: String('CRYPTO_KEY_FORMAT_RAW'),
        keyData: String(request.publicKey), // base64 encoded string from request
        keySpec: String('SIGNING_KEY_SPEC_EC_CURVE25519'),
      };

      // Runtime validation BEFORE calling Canton
      if (!publicKeyForAllocate.format || !publicKeyForAllocate.keyData || !publicKeyForAllocate.keySpec) {
        throw new Error(
          `Invalid publicKey structure for allocate: format=${!!publicKeyForAllocate.format}, ` +
          `keyData=${!!publicKeyForAllocate.keyData}, keySpec=${!!publicKeyForAllocate.keySpec}`
        );
      }

      // Build allocate request - NOTE: Do NOT include partyId - Canton doesn't expect it
      const allocateRequest = {
        synchronizer: synchronizerId, // STRING (not object) - REQUIRED
        topologyTransactions: txs, // REQUIRED - use topologyTransactions (Canton's field name)
        multiHashSignatures: [
          {
            publicKey: publicKeyForAllocate, // Use validated publicKey object
            signature: request.signature, // base64 encoded signature from frontend
          },
        ],
      };

      // Log FULL request body for debugging (before sending to API client)
      console.log('[Onboarding] Calling Canton /v2/parties/external/allocate...');
      console.log('[Onboarding] Allocate request (sanitized):', JSON.stringify({
        synchronizer: allocateRequest.synchronizer,
        topologyTransactionsCount: allocateRequest.topologyTransactions.length,
        multiHashSignatures: allocateRequest.multiHashSignatures.map(sig => ({
          publicKey: {
            format: sig.publicKey.format,
            keyDataLength: sig.publicKey.keyData.length,
            keyDataPrefix: sig.publicKey.keyData.substring(0, 20),
            keySpec: sig.publicKey.keySpec,
            hasFormat: !!sig.publicKey.format,
            hasKeyData: !!sig.publicKey.keyData,
            hasKeySpec: !!sig.publicKey.keySpec,
          },
          signatureLength: sig.signature.length,
          signaturePrefix: sig.signature.substring(0, 20),
        })),
      }, null, 2));
      
      // Validate structure one more time before sending
      const firstSig = allocateRequest.multiHashSignatures[0];
      if (!firstSig.publicKey.format || !firstSig.publicKey.keyData || !firstSig.publicKey.keySpec) {
        throw new Error(
          `CRITICAL: publicKey structure invalid before sending to Canton. ` +
          `format=${firstSig.publicKey.format}, keyData=${!!firstSig.publicKey.keyData}, keySpec=${firstSig.publicKey.keySpec}`
        );
      }
      
      // Log the EXACT structure being sent (for debugging)
      console.log('[Onboarding] Exact publicKey object being sent:', JSON.stringify(firstSig.publicKey, null, 2));
      console.log('[Onboarding] Full allocate request JSON (for debugging):', JSON.stringify(allocateRequest, null, 2));
      
      const allocateResponse = await client.allocateExternalParty(allocateRequest);
      
      // Derive partyHint for response (same as step 1 would have used)
      const partyHint = this.getOrGeneratePartyHint(request.publicKey, request.partyHint);
      
      console.log(`[Onboarding] Step 2 complete: Party allocated successfully: ${allocateResponse.party}`);
      console.log(`[Onboarding] partyHint: ${partyHint}, synchronizer: ${synchronizerId.substring(0, 20)}...`);
      
      return {
        step: 'ALLOCATED',
        partyId: allocateResponse.party,
        partyHint: partyHint,
        synchronizerId: synchronizerId,
      };
    }

    // Step 1: Generate topology (no signature provided)
    // Ensure partyHint is always non-empty (derive from publicKey if needed)
    const partyHint = this.getOrGeneratePartyHint(request.publicKey, request.partyHint);
    
    console.log('[Onboarding] Step 1: Generating topology for external party...');
    console.log(`[Onboarding] Using partyHint: ${partyHint}, synchronizer: ${synchronizerId.substring(0, 20)}...`);
    
    const topologyRequest = {
      synchronizer: synchronizerId, // STRING (not object)
      partyHint: partyHint, // Always non-empty
      publicKey: publicKeyObj,
    };

    const topologyResponse = await client.generateExternalPartyTopology(topologyRequest);

    // Debug: Log raw response from Canton to see actual field names
    console.log('[Onboarding] generate-topology response keys:', Object.keys(topologyResponse));
    console.log('[Onboarding] generate-topology raw response:', JSON.stringify(topologyResponse, null, 2));

    // Normalize response fields - Canton returns topologyTransactions (actual field name)
    // Map to onboardingTransactions for UI compatibility
    const multiHash = topologyResponse.multiHash || topologyResponse.multi_hash;
    
    // Canton returns topologyTransactions - use that as primary source
    const txs = 
      topologyResponse.topologyTransactions || // Canton's actual field name (PRIMARY)
      topologyResponse.onboardingTransactions || // Alias (if present)
      topologyResponse.onboarding_transactions || 
      topologyResponse.transactions ||
      topologyResponse.onboardingTxs ||
      [];
    
    const partyId = topologyResponse.partyId || topologyResponse.party || topologyResponse.externalParty;

    // Defensive check: ensure required fields exist
    if (!multiHash) {
      throw new Error(
        `Upstream generate-topology did not return multiHash. Response keys: ${Object.keys(topologyResponse).join(', ')}`
      );
    }

    if (!txs || !Array.isArray(txs) || txs.length === 0) {
      throw new Error(
        `Upstream generate-topology did not return topologyTransactions (or it's empty). ` +
        `Response keys: ${Object.keys(topologyResponse).join(', ')}. ` +
        `Raw response: ${JSON.stringify(topologyResponse, null, 2)}`
      );
    }

    // Note: generate-topology may return partyId, but the actual allocated partyId is from Step 2
    console.log(`[Onboarding] Step 1 complete: Topology generated. multiHash ready for signing.`);
    console.log(`[Onboarding] partyHint: ${partyHint}, synchronizer: ${synchronizerId.substring(0, 20)}...`);
    console.log(`[Onboarding] onboardingTransactions count: ${txs.length} (normalized from topologyTransactions)`);
    if (partyId) {
      console.log(`[Onboarding] Canton provided partyId: ${partyId}`);
    }

    // Return topology data for frontend to sign
    // ALWAYS include BOTH topologyTransactions (Canton's field) AND onboardingTransactions (alias)
    // Frontend can use either field - they're the same array
    return {
      step: 'TOPOLOGY',
      partyHint: partyHint,
      synchronizerId: synchronizerId,
      multiHash: multiHash,
      topologyTransactions: txs, // Canton's actual field name
      onboardingTransactions: txs, // Alias for UI compatibility (same array reference)
      // partyId is optional - include if Canton provides it
      ...(partyId && { partyId }),
    };
  }

  /**
   * Complete external party allocation (Step 2)
   * Called after frontend signs the multiHash
   */
  async completeExternalPartyAllocation(
    onboardingTransactions: string[],
    multiHash: string,
    signature: string, // base64 encoded signature
    publicKey: string, // base64 encoded public key
    partyHint?: string // Optional: party hint used in step 1
  ): Promise<AllocatePartyResponse> {
    const client = await this.getCantonClient();

    // Get synchronizer ID (from env or fetch from API)
    const synchronizerId = await this.getSynchronizerId();

    const allocateRequest = {
      synchronizer: synchronizerId, // STRING (not object)
      topologyTransactions: onboardingTransactions, // Normalize to Canton's field name
      multiHashSignatures: [
        {
          publicKey: {
            format: 'CRYPTO_KEY_FORMAT_RAW',
            keyData: publicKey,
            keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
          },
          signature,
        },
      ],
    };

    console.log('[Onboarding] Completing external party allocation...');
    const allocateResponse = await client.allocateExternalParty(allocateRequest);

    // Use provided partyHint or derive one from publicKey if not provided
    const finalPartyHint = partyHint 
      ? this.sanitizePartyHint(partyHint) 
      : this.derivePartyHint(publicKey);
    
    // Ensure non-empty (fallback to derived if sanitization resulted in empty)
    const safePartyHint = (finalPartyHint && finalPartyHint.length > 0) 
      ? finalPartyHint 
      : this.derivePartyHint(publicKey);

    return {
      step: 'ALLOCATED',
      partyId: allocateResponse.party,
      partyHint: safePartyHint,
      synchronizerId: synchronizerId,
    };
  }

  /**
   * Create transfer preapproval (idempotent)
   * Checks if it exists first, creates if missing
   */
  async createTransferPreapproval(party: string): Promise<void> {
    // Check if preapproval exists
    try {
      const existing = await this.scanClient.getTransferPreapprovalByParty(party);

      if (existing) {
        console.log(`Transfer preapproval already exists for party ${party}`);
        return;
      }
    } catch (error: any) {
      // If scan client fails, log and continue (don't break onboarding)
      console.warn(`Could not check for existing preapproval: ${error.message}`);
    }

    // TODO: Discover the template/choice for CreateTransferPreapproval
    // This will be discovered from installed packages
    // For now, log that it's not implemented and return success (don't break onboarding)
    console.log(`[Onboarding] Transfer preapproval creation not yet implemented for party ${party}. Skipping.`);
    
    // Return success - don't throw error that breaks onboarding flow
    // Frontend can proceed without preapproval for now
  }

  /**
   * Grant user rights (idempotent check)
   * Note: According to client, validator user already has canActAs rights
   * This is a verification step
   */
  async ensureUserRights(party: string): Promise<void> {
    // According to client note:
    // "The validator user already has canActAs right for this party, and scope daml_ledger_api is default"
    // So this is just a verification/logging step
    console.log(`Verifying rights for party ${party} (should already exist)`);
    // No action needed - rights are pre-granted
  }

  /**
   * Get connected synchronizers (for debugging)
   * Returns list of synchronizers from the JSON API
   */
  async getConnectedSynchronizers(): Promise<any> {
    const client = await this.getCantonClient();
    return await client.getConnectedSynchronizers();
  }
}
