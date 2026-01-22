/**
 * External Party Onboarding Service
 * Handles Canton JSON API v2 external party onboarding flow:
 * 1. Discover synchronizerId
 * 2. Generate topology (with signature requirements)
 * 3. Allocate party (with wallet signature)
 */

const crypto = require('crypto');
const config = require('../config');

class OnboardingService {
  constructor() {
    this.cachedSynchronizerId = null;
    this.synchronizerCacheExpiry = null;
    this.cachedToken = null;
    this.tokenExpiry = null;
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
   * STEP 2: Allocate party
   * Calls /v2/parties/external/allocate
   * Requires signature from wallet
   *
   * FIXES:
   * - Constructs publicKey object in backend (never trust frontend)
   * - Uses topologyTransactions from step 1 (DO NOT regenerate)
   * - Proper error handling with cause details
   */
  async allocateParty(publicKeyBase64, signatureBase64, topologyTransactions, publicKeyFingerprint) {
    const token = await this.getCantonToken();
    const synchronizerId = await this.discoverSynchronizerId();

    console.log('[OnboardingService] Allocating party with signature');

    // Normalize topology transactions (accept either key name)
    const txs = topologyTransactions || [];

    if (!txs || txs.length === 0) {
      throw new Error('topologyTransactions required for allocate step');
    }

    if (!signatureBase64 || signatureBase64.trim() === '') {
      throw new Error('signatureBase64 required for allocate step');
    }

    const url = `${config.canton.jsonApiBase}/v2/parties/external/allocate`;

    // Construct the publicKey object (Canton needs the full key, not just fingerprint)
    const publicKeyObj = {
      format: 'CRYPTO_KEY_FORMAT_RAW',
      keyData: publicKeyBase64,
      keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
    };

    const requestBody = {
      synchronizer: synchronizerId,
      topologyTransactions: txs,
      multiHashSignatures: [
        {
          publicKey: publicKeyObj,
          signature: {
            format: 'SIGNATURE_FORMAT_RAW',
            signature: signatureBase64,
            signedBy: publicKeyFingerprint,
            signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
          },
        },
      ],
    };

    // Log the exact JSON string being sent
    const requestBodyString = JSON.stringify(requestBody);
    console.log('[OnboardingService] Allocate request JSON string length:', requestBodyString.length);
    console.log('[OnboardingService] Allocate request (formatted):', JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: requestBodyString,
    });

    const responseText = await response.text();

    // Always log the response, even on error
    console.log('[OnboardingService] Allocate response status:', response.status);
    console.log('[OnboardingService] Allocate response text:', responseText);

    if (!response.ok) {
      // Try to parse error response as JSON for better error messages
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = JSON.stringify(errorJson, null, 2);
        console.log('[OnboardingService] Parsed error response:', errorDetails);
      } catch (e) {
        // Not JSON, use as-is
      }

      // Include upstream error as cause
      const statusCode = response.status;

      // Return proper status codes
      if (statusCode >= 400 && statusCode < 500) {
        const error = new Error(`Client error: ${responseText}`);
        error.statusCode = 400;
        error.cause = responseText;
        throw error;
      } else {
        const error = new Error(`Canton upstream error: ${responseText}`);
        error.statusCode = 502;
        error.cause = responseText;
        throw error;
      }
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response from allocate: ${responseText}`);
    }

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
  }

  /**
   * Ensure rights for party (optional - may be NO-OP)
   * Canton validator token should already have actAs rights
   * This is for compatibility and should not hard fail
   */
  async ensureRights(partyId) {
    console.log('[OnboardingService] Ensure-rights called for party:', partyId);
    // NO-OP for now - validator token already has rights
    // If needed in future, implement via gRPC UserManagementService
    return { success: true, message: 'Rights verification skipped (validator token has actAs)' };
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
