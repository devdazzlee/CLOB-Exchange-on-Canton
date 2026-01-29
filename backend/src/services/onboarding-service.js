/**
 * External Party Onboarding Service
 * Handles Canton JSON API v2 external party onboarding flow:
 * 1. Discover synchronizerId
 * 2. Generate topology (with signature requirements)
 * 3. Allocate party (with wallet signature)
 */

const crypto = require('crypto');
const config = require('../config');
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

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get Canton token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

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

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to discover synchronizerId: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

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

    const url = `${config.canton.jsonApiBase}/v2/parties/external/generate-topology`;

    // Construct publicKey object with proper format
    const publicKeyObj = {
      format: 'CRYPTO_KEY_FORMAT_RAW',
      keyData: publicKeyBase64,
      keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
    };

    const requestBody = {
      synchronizer: synchronizerId,
      partyHint: effectivePartyHint,
      publicKey: publicKeyObj,
    };

    console.log('[OnboardingService] Generate-topology request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();

    if (!response.ok) {
      // Return more helpful error
      throw new Error(`Generate topology failed (${response.status}): ${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response from generate-topology: ${responseText}`);
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
    const url = `${config.canton.jsonApiBase}/v2/idps`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      console.warn('[Onboarding] Failed to list IDPs, using empty string:', res.status, await res.text());
      return ""; // Fallback to empty string if endpoint not available
    }

    const data = await res.json();

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
      const res = await fetch(`${config.canton.jsonApiBase}/v2/parties/external/allocate`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`, 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      console.log('[OnboardingService] Allocate response status:', res.status);
      console.log('[OnboardingService] Allocate response text:', text);

      if (!res.ok) {
        // Handle 409 REQUEST_ALREADY_IN_FLIGHT - allocation is in progress
        if (res.status === 409) {
          try {
            const errorData = JSON.parse(text);
            
            // Check if it's REQUEST_ALREADY_IN_FLIGHT (retryable)
            if (errorData.code === 'REQUEST_ALREADY_IN_FLIGHT' && retryCount < maxRetries) {
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
            
            // Other 409 errors - don't retry
            throw new Error(`Allocate failed 409: ${text}`);
          } catch (parseError) {
            // If we can't parse the error, treat as non-retryable
            throw new Error(`Allocate failed 409 (unparseable): ${text}`);
          }
        }
        
        // Handle 503 (timeout) - allocation may still be processing
        if (res.status === 503 && retryCount < maxRetries) {
          // Exponential backoff with jitter
          const delay = Math.min(
            baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
            maxDelay
          );
          console.log(`[OnboardingService] Allocate timeout (503), retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this._allocateParty(body, token, synchronizerId, retryCount + 1);
        }
        
        // Other errors - don't retry
        throw new Error(`Allocate failed ${res.status}: ${text}`);
      }

      // Success - parse and return the JSON data
      const result = JSON.parse(text);
      
      // Clear in-flight tracking on success
      const partyHint = body.onboardingTransactions?.[0]?.transaction 
        ? this._extractPartyHintFromTransaction(body.onboardingTransactions[0].transaction)
        : null;
      if (partyHint) {
        this.inFlightAllocations.delete(partyHint);
      }
      
      return result;
    } catch (error) {
      // Network errors - retry if we haven't exhausted retries
      if (error.name === 'TypeError' && retryCount < maxRetries) {
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
      // Step 1: Allocate party (with proper retry handling for 409/503)
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
      const tokenResult = await this.createUserAccountAndMintTokens(allocationResult.partyId);

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

      // Debug: Extract and log user ID from token for rights verification
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
          console.log('[Onboarding] Checking user rights via JSON API v2...');
          const currentRights = await cantonService.getUserRights(adminToken, userId);
          console.log('[Onboarding] Current user rights:', JSON.stringify(currentRights, null, 2));
          
          // Check if user has canActAs for operator party (signatory)
          // UserAccount has signatory operator, observer party - so we only need operator in actAs
          const hasOperatorRights = currentRights.rights?.some(r => 
            r.canActAs?.party === operatorPartyId
          );
          
          console.log('[Onboarding] Has operator party rights (canActAs):', hasOperatorRights);
          
          // Grant rights for operator party if missing
          // Note: Operator party is a domain party, may not be grantable via JSON API
          // But we'll try anyway - the validator-operator user should already have these rights
          const partiesToGrant = [];
          if (!hasOperatorRights) {
            partiesToGrant.push(operatorPartyId);
            console.log('[Onboarding] Will grant rights for operator party:', operatorPartyId);
          }
          
          // Also ensure we have readAs for the new party (for visibility)
          // This is less critical but helps with querying
          const hasNewPartyReadRights = currentRights.rights?.some(r => 
            r.canReadAs?.party === partyId
          );
          if (!hasNewPartyReadRights) {
            // Grant readAs for new party (already done via gRPC, but ensure via JSON API too)
            partiesToGrant.push(partyId);
            console.log('[Onboarding] Will grant readAs rights for new party:', partyId);
          }
          
          if (partiesToGrant.length > 0) {
            console.log('[Onboarding] Granting missing rights via JSON API v2...');
            await cantonService.grantUserRights(adminToken, userId, partiesToGrant);
            console.log('[Onboarding] Rights granted successfully');
            // Wait a bit for rights to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.log('[Onboarding] User already has required rights');
          }
        } catch (rightsError) {
          console.warn('[Onboarding] Could not verify/grant rights via JSON API (may not be available):', rightsError.message);
          // Continue anyway - gRPC rights grant may be sufficient
        }
      } catch (tokenError) {
        console.warn('[Onboarding] Could not decode token for user ID:', tokenError.message);
        console.log('[Onboarding] Creating UserAccount for party:', partyId);
      }
      
      // ✅ Use template helper with package-id format (NOT package-name format)
      // This avoids package selection/vetting issues and runtime discovery
      const { userAccountTemplateId } = require('../utils/templateId');
      const templateId = userAccountTemplateId();
      
      console.log('[Onboarding] Using templateId:', templateId.substring(0, 50) + '...');

      const createArguments = {
        party: partyId,
        operator: operatorPartyId,
        // DA.Map.Map Text Decimal => encoded as JSON array of [key, value] pairs
        // NOT { map: [...] } - Canton expects direct array: [["USDT", "10000.0"]]
        balances: [
          ["USDT", "10000.0"]
        ],
      };

      // NOTE: synchronizerId is NOT used in submit-and-wait-for-transaction
      // It's only used in external party allocation endpoints
      // CRITICAL: UserAccount template has signatory operator, observer party
      // Therefore actAs MUST be operator only (signatory), party goes in readAs (observer)
      const result = await cantonService.createContract({
        token: adminToken,
        actAsParty: operatorPartyId, // Only operator is signatory
        templateId,
        createArguments,
        readAs: [operatorPartyId, partyId] // Include both for visibility (operator + observer)
      });

      console.log('[Onboarding] UserAccount created successfully:', result);
      
      return {
        userAccountCreated: true,
        usdtMinted: 10000,
        userAccountResult: result
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
      
      // Grant rights for the new party (for visibility)
      await grpcClient.grantUserRights(userId, partyId, adminToken);
      console.log('[Onboarding] Granted rights for new party:', partyId);
      
      // CRITICAL: Also grant rights for operator party
      // This is needed because UserAccount has operator as signatory
      // NOTE: Operator party may not be in the same identity provider (domain parties vs user parties)
      // If gRPC fails with NOT_FOUND, the operator party is likely a domain party and rights
      // are managed differently. We'll skip it and rely on the token having inherent operator rights.
      const operatorPartyId = config.canton.operatorPartyId;
      if (operatorPartyId && operatorPartyId !== partyId) {
        try {
          await grpcClient.grantUserRights(userId, operatorPartyId, adminToken);
          console.log('[Onboarding] Granted rights for operator party:', operatorPartyId);
        } catch (opError) {
          // Operator party is likely a domain party (not in user IDP) - this is expected
          // The validator-operator user should already have inherent rights for domain parties
          if (opError.message && opError.message.includes('NOT_FOUND') && opError.message.includes('PARTIES')) {
            console.log('[Onboarding] Operator party is a domain party (not in user IDP) - skipping rights grant (expected)');
          } else {
            console.warn(`[Onboarding] Could not grant operator party rights: ${opError.message}`);
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
   * Ensure rights for party (optional - may be NO-OP)
   * Canton validator token should already have actAs rights
   * This is for compatibility and should not hard fail
   */
  async ensureRights(partyId) {
    console.log('[OnboardingService] Ensure-rights called for party:', partyId);
    // Try to grant rights via gRPC
    return await this.grantOperatorRightsForParty(partyId);
  }

  /**
   * Create preapproval (optional - depends on installed packages)
   * Should not block onboarding if not implemented
   */
  async createPreapproval(partyId) {
    console.log('[OnboardingService] Create-preapproval called for party:', partyId);
    // Not implemented until we have exact template/choice from installed packages
    return { success: true, message: 'Preapproval skipped (not required for onboarding)' };
  }
}

module.exports = OnboardingService;
