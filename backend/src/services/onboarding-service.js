/**
 * External Party Onboarding Service
 * Handles Canton JSON API v2 external party onboarding flow:
 * 1. Discover synchronizerId
 * 2. Generate topology (with signature requirements)
 * 3. Allocate party (with wallet signature)
 */

const crypto = require('crypto');
const config = require('../config');
const { getCantonApi, getAuthApi } = require('../http/clients');
const cantonService = require('./cantonService');

class OnboardingService {
  constructor() {
    this.cachedSynchronizerId = null;
    this.synchronizerCacheExpiry = null;
    this.cachedToken = null;
    this.tokenExpiry = null;
    // Track in-flight allocations to prevent duplicates
    // Maps partyHint -> { promise, timestamp }
    this.inFlightAllocations = new Map();
    
    // External party allocation ONLY — users control their own keys.
    // Party gets Confirmation permission via topology.
  }

  /**
   * Get OAuth token for Canton JSON API access
   * Uses validator-app client credentials for ledger-api access
   */
  async getCantonToken() {
    // Return cached token if valid
    if (this.cachedToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const tokenUrl = config.canton.oauthTokenUrl;
    const clientId = config.canton.oauthClientId;
    const clientSecret = config.canton.oauthClientSecret;

    if (!clientSecret) {
      throw new Error('CANTON_OAUTH_CLIENT_SECRET not configured');
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid profile email daml_ledger_api',
    });

    let data;
    try {
      const response = await getAuthApi().post(tokenUrl, params.toString());
      data = response.data;
    } catch (error) {
      const status = error.response?.status || 'unknown';
      const errorText = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data);
      throw new Error(`Failed to get Canton token: ${status} - ${errorText}`);
    }

    if (!data || !data.access_token) {
      throw new Error('Token response missing access_token');
    }

    // Cache token with 5 minute buffer before expiry
    this.cachedToken = data.access_token;
    this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);

    return this.cachedToken;
  }

  /**
   * Discover synchronizerId from Canton
   * Uses /v2/state/connected-synchronizers endpoint
   * Caches result for 5 minutes
   */
  async discoverSynchronizerId() {
    // Return env override if set
    if (config.canton.synchronizerId) {
      console.log('[OnboardingService] Using synchronizerId from env:', config.canton.synchronizerId);
      return config.canton.synchronizerId;
    }

    // Return cached value if valid
    if (this.cachedSynchronizerId && this.synchronizerCacheExpiry && Date.now() < this.synchronizerCacheExpiry) {
      return this.cachedSynchronizerId;
    }

    const token = await this.getCantonToken();
    const url = `${config.canton.jsonApiBase}/v2/state/connected-synchronizers`;

    console.log('[OnboardingService] Discovering synchronizerId from:', url);

    let data;
    try {
      const response = await getCantonApi().get('/v2/state/connected-synchronizers', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      data = response.data;
    } catch (error) {
      const status = error.response?.status || 'unknown';
      const errorText = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data);
      throw new Error(`Failed to discover synchronizerId: ${status} - ${errorText}`);
    }

    // Extract synchronizerId from response
    // Response format: { connectedSynchronizers: [{ synchronizerAlias: "global", synchronizerId: "global-domain::..." }] }
    let synchronizerId = null;

    // Check for connectedSynchronizers array (actual API field name)
    if (data.connectedSynchronizers && Array.isArray(data.connectedSynchronizers) && data.connectedSynchronizers.length > 0) {
      const synchronizers = data.connectedSynchronizers;
      
      // Try to find one with synchronizerAlias "global" (actual API field name)
      const globalSync = synchronizers.find(s => 
        s.synchronizerAlias === 'global' || s.alias === 'global'
      );
      if (globalSync && globalSync.synchronizerId) {
        synchronizerId = globalSync.synchronizerId;
      } else {
        // Prefer one containing "global-domain" in the ID
        const globalDomainSync = synchronizers.find(s => 
          s.synchronizerId && s.synchronizerId.includes('global-domain')
        );
        if (globalDomainSync && globalDomainSync.synchronizerId) {
          synchronizerId = globalDomainSync.synchronizerId;
        } else {
          // Fallback to first synchronizer
          synchronizerId = synchronizers[0].synchronizerId || synchronizers[0].id;
        }
      }
    } 
    // Legacy support: check for synchronizers (plural, without "connected" prefix)
    else if (data.synchronizers && Array.isArray(data.synchronizers) && data.synchronizers.length > 0) {
      synchronizerId = data.synchronizers[0].synchronizerId || data.synchronizers[0].id;
    } 
    // Direct synchronizerId field
    else if (data.synchronizerId) {
      synchronizerId = data.synchronizerId;
    } 
    // Array response (unlikely but handle it)
    else if (Array.isArray(data) && data.length > 0) {
      synchronizerId = data[0].synchronizerId || data[0].id;
    }

    if (!synchronizerId) {
      throw new Error('Could not extract synchronizerId from response: ' + JSON.stringify(data));
    }

    console.log('[OnboardingService] Discovered synchronizerId:', synchronizerId);

    // Cache for 5 minutes
    this.cachedSynchronizerId = synchronizerId;
    this.synchronizerCacheExpiry = Date.now() + (5 * 60 * 1000);

    return synchronizerId;
  }

  /**
   * Generate partyHint from publicKey if not provided
   * Ensures partyHint is never empty
   */
  generatePartyHint(publicKeyBase64) {
    const hash = crypto.createHash('sha256').update(publicKeyBase64).digest('hex');
    return `ext-${hash.substring(0, 12)}`;
  }

  /**
   * STEP 1: Generate topology
   * Calls /v2/parties/external/generate-topology
   * Returns multiHash + topology transactions for signing
   *
   * FIXES:
   * - Normalizes response: onboardingTransactions = topologyTransactions
   * - Ensures partyHint is never empty
   * - Returns both keys for compatibility
   */
  async generateTopology(publicKeyBase64, partyHint) {
    const token = await this.getCantonToken();
    const synchronizerId = await this.discoverSynchronizerId();

    // Ensure partyHint is not empty
    const effectivePartyHint = partyHint && partyHint.trim() !== ''
      ? partyHint.trim()
      : this.generatePartyHint(publicKeyBase64);

    console.log('[OnboardingService] Generating topology for partyHint:', effectivePartyHint);

    // Construct publicKey object with proper format
    const publicKeyObj = {
      format: 'CRYPTO_KEY_FORMAT_RAW',
      keyData: publicKeyBase64,
      keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
    };

    // Build request body for external party topology generation.
    // Permission "Confirmation" ensures the external party can confirm (sign) transactions
    // but does not need to directly submit commands — the participant/validator does that.
    // This is the recommended permission for exchange users: the exchange submits commands,
    // the user's key is used for confirmation, ensuring all transactions have user authority.
    const requestBody = {
      synchronizer: synchronizerId,
      partyHint: effectivePartyHint,
      publicKey: publicKeyObj,
      permission: 'Confirmation', // External party: user controls key, confirms transactions
    };

    console.log('[OnboardingService] Generate-topology request (external party, Confirmation permission):', JSON.stringify(requestBody, null, 2));

    let data;
    try {
      const response = await getCantonApi().post('/v2/parties/external/generate-topology', requestBody, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      data = response.data;
    } catch (error) {
      const status = error.response?.status || 'unknown';
      const errorText = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data);
      throw new Error(`Generate topology failed (${status}): ${errorText}`);
    }

    console.log('[OnboardingService] Generate-topology response:', JSON.stringify(data, null, 2));

    // FIX: Normalize response to handle both topologyTransactions and onboardingTransactions
    const topologyTransactions = data.topologyTransactions || data.onboardingTransactions || [];
    const multiHash = data.multiHash;
    const publicKeyFingerprint = data.publicKeyFingerprint;
    const partyId = data.partyId; // May or may not be present

    if (!multiHash) {
      throw new Error('Generate-topology response missing multiHash');
    }

    if (!topologyTransactions || topologyTransactions.length === 0) {
      throw new Error('Generate-topology response missing topology transactions');
    }

    // Return normalized response with BOTH keys for compatibility
    return {
      step: 'TOPOLOGY',
      synchronizerId,
      partyHint: effectivePartyHint,
      multiHash,
      publicKeyFingerprint,
      topologyTransactions,
      onboardingTransactions: topologyTransactions, // Same data, different key for compatibility
      partyId, // May be present in some responses
    };
  }

  /**
   * Discover Identity Provider ID from Canton
   * Uses GET /v2/idps to list available identity providers
   */
  async discoverIdentityProviderId() {
    const token = await this.getCantonToken();

    let data;
    try {
      const res = await getCantonApi().get('/v2/idps', {
        headers: { Authorization: `Bearer ${token}` },
      });
      data = res.data;
    } catch (error) {
      console.warn('[Onboarding] Failed to list IDPs, using empty string:', error.response?.status, error.response?.data || error.message);
      return ""; // Fallback to empty string if endpoint not available
    }

    // Handle different response formats
    const idps = data.identityProviderConfigs || data.result || data || [];
    if (!Array.isArray(idps) || idps.length === 0) {
      console.warn('[Onboarding] No IDPs found, using empty string');
      return ""; // Fallback to empty string
    }

    // Prefer active/default if present, otherwise first
    const active = idps.find(x => x.isDeactivated === false) || idps[0];
    const idpId = active.identityProviderId || active.id;

    if (!idpId) {
      console.warn('[Onboarding] Could not extract identityProviderId, using empty string');
      return ""; // Fallback to empty string
    }

    console.log('[Onboarding] Discovered identityProviderId:', idpId);
    return idpId;
  }

  /**
   * STEP 2: Allocate party
   * Calls /v2/parties/external/allocate
   * Requires signature from wallet
   *
   * FIXES:
   * - Constructs publicKey object in backend (never trust frontend)
   * - Uses topologyTransactions from step 1 (DO NOT regenerate)
   * - Proper error handling with cause details
   * - Prevents duplicate allocations for the same partyHint
   * - Handles 409 REQUEST_ALREADY_IN_FLIGHT gracefully
   */
  async allocateParty(publicKeyBase64, signatureBase64, topologyTransactions, publicKeyFingerprint, partyHint = null) {
    try {
      const token = await this.getCantonToken();
      const synchronizerId = await this.discoverSynchronizerId();
      const identityProviderId = await this.discoverIdentityProviderId();

      // IMPORTANT: allocate expects onboardingTransactions = [{ transaction }]
      const onboardingTransactions = topologyTransactions.map((t) => ({ transaction: t }));

      const body = {
        synchronizer: synchronizerId,
        identityProviderId, // Add identityProviderId (may be empty string)
        onboardingTransactions,
        multiHashSignatures: [
          {
            format: "SIGNATURE_FORMAT_CONCAT",
            signature: signatureBase64,
            signedBy: publicKeyFingerprint,
            signingAlgorithmSpec: "SIGNING_ALGORITHM_SPEC_ED25519"
          }
        ]
      };

      // Create a deduplication key from partyHint or first transaction
      const dedupKey = partyHint || this._extractPartyHintFromTransaction(onboardingTransactions[0]?.transaction);
      
      // Check if allocation is already in flight for this party
      if (dedupKey && this.inFlightAllocations.has(dedupKey)) {
        const inFlight = this.inFlightAllocations.get(dedupKey);
        const age = Date.now() - inFlight.timestamp;
        
        // If it's been more than 5 minutes, consider it stale and allow retry
        if (age > 5 * 60 * 1000) {
          console.log(`[OnboardingService] Clearing stale in-flight allocation for ${dedupKey}`);
          this.inFlightAllocations.delete(dedupKey);
        } else {
          // Wait for the existing allocation to complete
          console.log(`[OnboardingService] Allocation already in flight for ${dedupKey}, waiting...`);
          try {
            const result = await inFlight.promise;        
            return {
              step: 'ALLOCATED',
              partyId: result.partyId || result.party || result.identifier,
              synchronizerId,
            };
          } catch (error) {
            // If the existing allocation failed, we can try again
            console.log(`[OnboardingService] Previous allocation failed, retrying...`);
            this.inFlightAllocations.delete(dedupKey);
          }
        }
      }

      // Create a promise for this allocation and track it
      const allocationPromise = this._allocateParty(body, token, synchronizerId);
      
      if (dedupKey) {
        this.inFlightAllocations.set(dedupKey, {
          promise: allocationPromise,
          timestamp: Date.now()
        });
      }

      console.log('[OnboardingService] Allocate request (formatted):', JSON.stringify(body, null, 2));

      const result = await allocationPromise;
      const data = result; // _allocateParty now returns parsed JSON directly
      console.log('[OnboardingService] Allocate response:', JSON.stringify(data, null, 2));

      // Extract partyId from response
      const partyId = data.partyId || data.party || data.identifier;

      if (!partyId) {
        throw new Error('Allocate response missing partyId');
      }

      return {
        step: 'ALLOCATED',
        partyId,
        synchronizerId,
      };
    } catch (error) {
      console.error('[OnboardingService] Allocate error:', error);
      throw error;
    }
  }

  /**
   * Allocate party with proper retry handling for 503 (timeout) and 409 (already in flight)
   * 
   * Handles:
   * - 503: HTTP timeout (allocation may still be processing on participant)
   * - 409 REQUEST_ALREADY_IN_FLIGHT: Allocation is in progress, retry after delay
   * - Network errors: Retry with exponential backoff
   * 
   * Uses Canton's retryInfo when available for optimal retry timing.
   */
  async _allocateParty(body, token, synchronizerId, retryCount = 0) {
    const maxRetries = 10; // Increased for 409 handling
    const baseDelay = 1000; // 1 second base
    const maxDelay = 10000; // 10 seconds max

    try {
      const res = await getCantonApi().post('/v2/parties/external/allocate', body, {
        headers: { Authorization: `Bearer ${token}` },
      });

      console.log('[OnboardingService] Allocate response status:', res.status);
      console.log('[OnboardingService] Allocate response text:', JSON.stringify(res.data));

      const result = res.data;

      // Clear in-flight tracking on success
      const partyHint = body.onboardingTransactions?.[0]?.transaction 
        ? this._extractPartyHintFromTransaction(body.onboardingTransactions[0].transaction)
        : null;
      if (partyHint) {
        this.inFlightAllocations.delete(partyHint);
      }
      
      return result;
    } catch (error) {
      const status = error.response?.status;
      const responseData = error.response?.data;
      const text = typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData || {});

      if (status) {
        console.log('[OnboardingService] Allocate response status:', status);
        console.log('[OnboardingService] Allocate response text:', text);
      }

      // Handle 409 REQUEST_ALREADY_IN_FLIGHT - allocation is in progress
      if (status === 409) {
        try {
          const errorData = typeof responseData === 'object' && responseData !== null
            ? responseData
            : JSON.parse(text);
          
          // Check if it's REQUEST_ALREADY_IN_FLIGHT (retryable)
          if (errorData.code === 'REQUEST_ALREADY_IN_FLIGHT') {
            // Extract party hint from error message
            const partyMatch = errorData.cause?.match(/Party\s+([\w-]+)\s+is in the process/);
            const allocatingPartyHint = partyMatch ? partyMatch[1] : null;
            
            if (retryCount < maxRetries) {
              // Use Canton's retryInfo if available, otherwise use exponential backoff
              let delay = baseDelay;
              
              if (errorData.retryInfo) {
                // Parse retryInfo (e.g., "1 second" or "2 seconds")
                const retryMatch = errorData.retryInfo.match(/(\d+)\s*(second|seconds?)/i);
                if (retryMatch) {
                  delay = parseInt(retryMatch[1]) * 1000;
                }
              } else {
                // Exponential backoff with jitter
                delay = Math.min(
                  baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
                  maxDelay
                );
              }
              
              console.log(`[OnboardingService] Allocation in progress (409), retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              return this._allocateParty(body, token, synchronizerId, retryCount + 1);
            }
            
            // Exhausted retries - check if party was actually allocated
            console.log(`[OnboardingService] Exhausted retries. Checking if party ${allocatingPartyHint} was allocated...`);
            if (allocatingPartyHint) {
              try {
                // Wait a bit more for allocation to complete
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Try to list parties to check if it exists
                const cantonService = require('./cantonService');
                const parties = await cantonService.listParties(token);
                
                // Find our party in the list
                const foundParty = parties.find(p => 
                  p.identifier?.party?.includes(allocatingPartyHint) ||
                  p.party?.includes(allocatingPartyHint)
                );
                
                if (foundParty) {
                  const partyId = foundParty.identifier?.party || foundParty.party;
                  console.log(`[OnboardingService] Party was allocated successfully: ${partyId}`);
                  
                  // Return a synthetic result mimicking the successful allocation response
                  return {
                    partyId: partyId,
                    userId: body.identityProviderId ? null : undefined,
                    _recoveredFromInFlight: true
                  };
                }
              } catch (checkError) {
                console.warn(`[OnboardingService] Could not verify party allocation: ${checkError.message}`);
              }
            }
          }
          
          // Other 409 errors or couldn't verify allocation - don't retry
          throw new Error(`Allocate failed 409: ${text}`);
        } catch (parseError) {
          // If we can't parse the error, treat as non-retryable
          throw new Error(`Allocate failed 409 (unparseable): ${text}`);
        }
      }
      
      // Handle 503 (timeout) - allocation may still be processing
      if (status === 503 && retryCount < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
          maxDelay
        );
        console.log(`[OnboardingService] Allocate timeout (503), retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._allocateParty(body, token, synchronizerId, retryCount + 1);
      }
      
      // Network errors - retry if we haven't exhausted retries
      if (!error.response && retryCount < maxRetries) {
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
          maxDelay
        );
        console.log(`[OnboardingService] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._allocateParty(body, token, synchronizerId, retryCount + 1);
      }
      
      // Clear in-flight tracking on final error
      const partyHint = body.onboardingTransactions?.[0]?.transaction 
        ? this._extractPartyHintFromTransaction(body.onboardingTransactions[0].transaction)
        : null;
      if (partyHint) {
        this.inFlightAllocations.delete(partyHint);
      }
      
      if (status) {
        throw new Error(`Allocate failed ${status}: ${text}`);
      }
      
      throw error;
    }
  }

  /**
   * Extract partyHint from base64-encoded transaction (for tracking)
   * This is a best-effort extraction for deduplication
   */
  _extractPartyHintFromTransaction(transactionBase64) {
    try {
      // Transaction contains partyHint in the encoded data
      // We use a simple hash of the transaction as the key
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(transactionBase64).digest('hex').substring(0, 16);
    } catch (e) {
      return null;
    }
  }

  /**
   * Complete onboarding flow - allocate party and create UserAccount with tokens
   */
  /**
   * Complete onboarding flow - allocate party and create UserAccount with tokens
   * 
   * Handles retries gracefully - if allocation is in progress (409), waits and retries
   */
  async completeOnboarding(publicKeyBase64, signatureBase64, topologyTransactions, publicKeyFingerprint, partyHint = null) {
    try {
      // External party allocation: User controls their own private key.
      // Party gets Confirmation permission via topology — user signs to confirm transactions,
      // ensuring every transaction has the authority of the owning user.
      console.log('[Onboarding] ✅ Using EXTERNAL party allocation (user controls key, Confirmation permission)');
      const allocationResult = await this.allocateParty(
        publicKeyBase64,
        signatureBase64,
        topologyTransactions,
        publicKeyFingerprint,
        partyHint
      );

      console.log('[Onboarding] Party allocated successfully:', allocationResult.partyId);

      // Step 1.5: Grant operator rights for the new party (if gRPC available)
      // This ensures the operator can create contracts for the newly allocated party
      try {
        await this.grantOperatorRightsForParty(allocationResult.partyId);
        // Invalidate token cache to force refresh with new permissions
        const tokenProvider = require('./tokenProvider');
        tokenProvider.invalidate('service');
        console.log('[Onboarding] Token cache invalidated after rights grant');
        
        // Longer delay to allow rights to propagate through Canton's system
        console.log('[Onboarding] Waiting for rights to propagate...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased to 3 seconds
      } catch (rightsError) {
        console.warn('[Onboarding] Failed to grant operator rights (may not be required):', rightsError.message);
        // Continue anyway - some setups may not require explicit rights granting
        // Still add a delay for rights propagation
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Step 2: Create UserAccount and mint tokens
      // Use the same token that was used for gRPC rights grant (validator-app token)
      // NOTE: This may fail if the operator party isn't connected to the same synchronizer
      // as the new external party. This is a Canton topology configuration issue.
      let tokenResult = {};
      try {
        tokenResult = await this.createUserAccountAndMintTokens(allocationResult.partyId);
      } catch (accountError) {
        console.warn('[Onboarding] UserAccount creation failed:', accountError.message);
        
        // External party allocated but UserAccount creation failed — report topology issue.
        if (accountError.code === 'NO_SYNCHRONIZER_FOR_SUBMISSION') {
          console.warn('[Onboarding] External party allocated but UserAccount failed due to topology.');
          console.warn('[Onboarding] This is a Canton topology configuration issue — ensure the operator party is connected to the same synchronizer as the external party.');
          tokenResult = {
            userAccountCreated: false,
            userAccountPending: true,
            userAccountError: 'Topology configuration issue. Ensure operator is on the same synchronizer.',
            usdtMinted: 0,
            externalPartyAllocated: true,
            externalPartyId: allocationResult.partyId,
          };
        } else {
          // For other errors, still throw
          throw accountError;
        }
      }

      return {
        ...allocationResult,
        ...tokenResult,
      };
    } catch (error) {
      console.error('[Onboarding] Complete onboarding failed:', error);
      
      // Provide more helpful error messages
      if (error.message && error.message.includes('REQUEST_ALREADY_IN_FLIGHT')) {
        throw new Error(
          'Party allocation is already in progress. Please wait a moment and check wallet status. ' +
          'The allocation will complete automatically.'
        );
      }
      
      throw error;
    }
  }

  /**
   * Create UserAccount and seed 10,000 USDT for a new party
   * Uses correct JSON API v2 format with package-id (not package-name) to avoid vetting issues
   */
  async createUserAccountAndMintTokens(partyId) {
    try {
      // Use the same token source as gRPC calls (validator-app token via tokenProvider)
      // This ensures consistent permissions across all Canton operations
      const tokenProvider = require('./tokenProvider');
      const adminToken = await tokenProvider.getServiceToken();
      const operatorPartyId = config.canton.operatorPartyId;

      let userId = null;
      try {
        const tokenPayload = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64').toString());
        userId = tokenPayload.sub;
        console.log('[Onboarding] Token user ID (sub):', userId);
        console.log('[Onboarding] Creating UserAccount for party:', partyId);
        console.log('[Onboarding] Using operator party:', operatorPartyId);
        
        // CRITICAL: Verify and grant rights via JSON API v2 before creating contract
        // This ensures the user has canActAs for both parties
        try {
          // Discover identity provider ID (required for granting rights)
          const identityProviderId = await this.discoverIdentityProviderId();
          console.log('[Onboarding] Using identityProviderId for rights:', identityProviderId);
          
          console.log('[Onboarding] Checking user rights via JSON API v2...');
          const currentRightsRaw = await cantonService.getUserRights(adminToken, userId);
          console.log('[Onboarding] Current user rights (raw):', JSON.stringify(currentRightsRaw, null, 2));
          
          // Parse rights using the helper that handles 'kind' wrapper format
          // Canton JSON Ledger API v2 returns: { rights: [{ kind: { CanActAs: { value: { party } } } }] }
          const parsedRights = cantonService.parseUserRights(currentRightsRaw);
          console.log('[Onboarding] Parsed user rights:', JSON.stringify(parsedRights, null, 2));
          
          // Check if user has canActAs for operator party (signatory)
          // UserAccount has signatory operator, observer party - so we only need operator in actAs
          const hasOperatorRights = parsedRights.canActAs.includes(operatorPartyId);
          
          console.log('[Onboarding] Has operator party rights (canActAs):', hasOperatorRights);
          
          // IMPORTANT: Operator party is a DOMAIN/SYSTEM party (global-domain::...)
          // Domain parties are NOT in the user identity provider
          // You CANNOT grant rights for domain parties via the JSON API user rights endpoint
          // The service account token should already have inherent operator rights
          
          const partiesToGrant = [];
          
          // Skip operator party - it's a domain party, not grantable via user rights API
          if (!hasOperatorRights) {
            console.log('[Onboarding] Note: Operator party rights missing, but operator is a domain party');
            console.log('[Onboarding] Domain parties cannot be granted via JSON API - relying on token inherent rights');
          }
          
          // Grant rights for the NEW USER party (which IS in the identity provider)
          const hasNewPartyActRights = parsedRights.canActAs.includes(partyId);
          const hasNewPartyReadRights = parsedRights.canReadAs.includes(partyId);
          if (!hasNewPartyActRights || !hasNewPartyReadRights) {
            partiesToGrant.push(partyId);
            console.log('[Onboarding] Will grant rights for new user party:', partyId);
          }
          
          if (partiesToGrant.length > 0) {
            console.log('[Onboarding] Granting missing rights via JSON API v2...');
            await cantonService.grantUserRights(adminToken, userId, partiesToGrant, identityProviderId);
            console.log('[Onboarding] Rights granted successfully');
            // Wait a bit for rights to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.log('[Onboarding] User already has required rights');
          }
        } catch (rightsError) {
          const errMsg = rightsError.message || '';
          if (!errMsg.includes('security-sensitive') && !errMsg.includes('403')) {
            console.warn('[Onboarding] Could not verify/grant rights via JSON API:', errMsg);
          }
          // Continue anyway - gRPC rights grant or interactive submission is sufficient
        }
      } catch (tokenError) {
        console.warn('[Onboarding] Could not decode token for user ID:', tokenError.message);
        console.log('[Onboarding] Creating UserAccount for party:', partyId);
      }
      
      // No dummy Holdings are created on party creation.
      // Users receive real CC/CBTC tokens through their Cardiv wallet (external transfers).
      // Creating on-chain Holding contracts at onboarding time pollutes the ledger with
      // dummy contracts that the client has flagged as unwanted.
      console.log('[Onboarding] Party onboarded — no dummy Holdings created. Tokens arrive via Cardiv wallet.');
      
      return {
        userAccountCreated: false,
        holdingsCreated: false,
        tokenStandard: true,
        initialHoldings: []
      };
    } catch (error) {
      console.error('[Onboarding] Failed to create UserAccount or mint tokens:', error);
      
      // Provide more helpful error message for package vetting issues
      if (error.message && error.message.includes('PACKAGE_SELECTION_FAILED')) {
        const enhancedError = new Error(
          `Package vetting issue: The package may not be vetted on all hosting participants. ` +
          `Original error: ${error.message}`
        );
        enhancedError.cause = error;
        throw enhancedError;
      }
      
      throw error;
    }
  }

  /**
   * Helper method to mint tokens via Faucet
   */
  async mintTokens(partyId, tokenType, amount) {
    const adminToken = await this.getCantonToken();
    const synchronizerId = await this.discoverSynchronizerId();
    
    // ✅ Use package-id format: "<packageId>:Module:Entity" (NOT package-name format)
    const packageId = await cantonService.getPackageIdForTemplate('Faucet', adminToken);
    const templateId = `${packageId}:Faucet:Faucet`;
    
    // First, we need to find the Faucet contract ID
    const faucetContracts = await cantonService.queryActiveContracts({
      party: config.canton.operatorPartyId,
      templateIds: [templateId]
    }, adminToken);
    
    if (!faucetContracts.activeContracts || faucetContracts.activeContracts.length === 0) {
      throw new Error('Faucet contract not found');
    }
    
    const faucetContractId = faucetContracts.activeContracts[0].contractId;
    
    return cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: config.canton.operatorPartyId,
      templateId,
      contractId: faucetContractId,
      choice: "MintTestTokens",
      choiceArgument: { party: partyId, tokenType, amount },
      readAs: [config.canton.operatorPartyId],
      synchronizerId,
    });
  }

  /**
   * Grant operator rights for a newly allocated party via gRPC
   * This ensures the operator can create contracts for the new party
   */
  async grantOperatorRightsForParty(partyId) {
    try {
      const adminToken = await this.getCantonToken();
      
      // Extract user ID from token (JWT 'sub' claim)
      const tokenPayload = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64').toString());
      const userId = tokenPayload.sub;
      
      if (!userId) {
        throw new Error('Could not extract user ID from token');
      }

      // Use gRPC to grant rights
      const CantonGrpcClient = require('./canton-grpc-client');
      const grpcClient = new CantonGrpcClient();
      
      // ── 1. Grant to validator-operator (best effort — may hit TOO_MANY_USER_RIGHTS) ──
      try {
        await grpcClient.grantUserRights(userId, partyId, adminToken);
        console.log('[Onboarding] Granted rights for new party to validator-operator:', partyId);
      } catch (err) {
        if (err.message && err.message.includes('TOO_MANY_USER_RIGHTS')) {
          console.warn(`[Onboarding] TOO_MANY_USER_RIGHTS for validator-operator — skipping (executor will handle interactive submissions)`);
        } else {
          console.warn(`[Onboarding] Could not grant validator-operator rights for ${partyId}: ${err.message}`);
        }
      }

      // ── 2. CRITICAL: Grant rights to executor (cardiv) user ──
      // The executor token is used for ALL interactive submissions (TransferInstruction_Accept,
      // AllocationFactory_Allocate). Without actAs rights for the user's party, the executor
      // token gets HTTP 403 on prepare.  Cardiv is a separate identity and has far fewer
      // party grants than the validator-operator, so it won't hit TOO_MANY_USER_RIGHTS.
      try {
        const tokenProvider = require('./tokenProvider');
        const executorToken = await tokenProvider.getExecutorToken();
        const execPayload = JSON.parse(Buffer.from(executorToken.split('.')[1], 'base64').toString());
        const executorUserId = execPayload.sub;

        if (executorUserId && executorUserId !== userId) {
          await grpcClient.grantUserRights(executorUserId, partyId, adminToken);
          console.log('[Onboarding] ✅ Granted actAs rights for new party to executor (cardiv):', partyId.substring(0, 40));
        } else if (executorUserId === userId) {
          console.log('[Onboarding] Executor and validator-operator are the same user — rights already handled above');
        }
      } catch (execErr) {
        if (execErr.message && execErr.message.includes('TOO_MANY_USER_RIGHTS')) {
          console.warn(`[Onboarding] TOO_MANY_USER_RIGHTS for executor too — interactive submission may fail for this party`);
        } else {
          console.warn(`[Onboarding] Could not grant executor rights for ${partyId}: ${execErr.message}`);
        }
      }

      // CRITICAL: Also grant rights for operator party (best effort)
      const operatorPartyId = config.canton.operatorPartyId;
      if (operatorPartyId && operatorPartyId !== partyId) {
        try {
          // Grant to validator-operator
          await grpcClient.grantUserRights(userId, operatorPartyId, adminToken);
          console.log('[Onboarding] Granted rights for operator party to validator-operator:', operatorPartyId);
        } catch (opError) {
          if (opError.message && (opError.message.includes('NOT_FOUND') || opError.message.includes('PARTIES'))) {
             // expected if domain party
          } else if (opError.message && opError.message.includes('TOO_MANY_USER_RIGHTS')) {
            console.warn('[Onboarding] TOO_MANY_USER_RIGHTS for operator party to validator-operator — skipping');
          }
        }
        
        try {
          // Grant to executor user!
          const tokenProvider = require('./tokenProvider');
          const executorToken = await tokenProvider.getExecutorToken();
          const execPayload = JSON.parse(Buffer.from(executorToken.split('.')[1], 'base64').toString());
          const executorUserId = execPayload.sub;
          if (executorUserId && executorUserId !== userId) {
            await grpcClient.grantUserRights(executorUserId, operatorPartyId, adminToken);
            console.log('[Onboarding] ✅ Granted rights for operator party to executor (cardiv):', operatorPartyId);
          }
        } catch (opExecError) {
          if (!opExecError.message.includes('NOT_FOUND')) {
            console.warn('[Onboarding] Could not grant operator rights to executor:', opExecError.message);
          }
        }
      }
      
      return { success: true };
    } catch (error) {
      console.warn('[Onboarding] Failed to grant operator rights via gRPC:', error.message);
      // Don't throw - this might not be available in all setups
      return { success: false, error: error.message };
    }
  }

  /**
   * Retroactively grant executor (cardiv) actAs rights for ALL existing user parties.
   * Called once at server startup to fix parties onboarded before the executor-rights fix.
   * Runs in the background — does not block startup.
   */
  async grantExecutorRightsToAllParties() {
    console.log('[Onboarding] 🔄 Retroactive executor rights grant — starting background job...');
    try {
      const userRegistry = require('../state/userRegistry');
      const partyIds = await userRegistry.getAllPartyIds();
      if (!partyIds || partyIds.length === 0) {
        console.log('[Onboarding] No existing parties to backfill');
        return;
      }

      const adminToken = await this.getCantonToken();
      const tokenProvider = require('./tokenProvider');
      const executorToken = await tokenProvider.getExecutorToken();
      const execPayload = JSON.parse(Buffer.from(executorToken.split('.')[1], 'base64').toString());
      const executorUserId = execPayload.sub;

      if (!executorUserId) {
        console.warn('[Onboarding] Could not extract executor user ID — skipping backfill');
        return;
      }

      const CantonGrpcClient = require('./canton-grpc-client');
      const grpcClient = new CantonGrpcClient();

      // Ensure the executor has rights for the operator party!
      const operatorPartyId = config.canton.operatorPartyId;
      if (operatorPartyId) {
        try {
          await grpcClient.grantUserRights(executorUserId, operatorPartyId, adminToken);
          console.log('[Onboarding] Granted operator party rights to executor.');
        } catch (err) {
          console.warn('[Onboarding] Operator party grant to executor failed (may be domain party or already exists):', err.message);
        }
      }

      let granted = 0, skipped = 0, failed = 0;
      for (const partyId of partyIds) {
        try {
          await grpcClient.grantUserRights(executorUserId, partyId, adminToken);
          granted++;
        } catch (err) {
          const msg = err.message || '';
          if (msg.includes('TOO_MANY_USER_RIGHTS')) {
            console.warn('[Onboarding] Executor hit TOO_MANY_USER_RIGHTS during backfill — stopping');
            break;
          } else if (msg.includes('already') || msg.includes('duplicate') || msg.includes('ALREADY_EXISTS')) {
            skipped++; // Rights already exist — not an error
          } else {
            failed++;
            console.warn(`[Onboarding] Backfill failed for ${partyId.substring(0, 30)}...: ${msg}`);
          }
        }
      }

      console.log(`[Onboarding] ✅ Executor rights backfill complete: granted=${granted}, already_existed=${skipped}, failed=${failed}`);
    } catch (err) {
      console.warn('[Onboarding] Executor rights backfill error (non-fatal):', err.message);
    }
  }
}

module.exports = OnboardingService;
