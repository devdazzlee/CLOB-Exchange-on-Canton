/**
 * Wallet Service - External Party Onboarding
 * 
 * Implements Canton's documented external party onboarding flow:
 * 1. Generate topology transactions
 * 2. User signs multiHash client-side
 * 3. Allocate external party with signature
 * 
 * NO KEYCLOAK LOGIN FOR END-USERS.
 * Private keys NEVER sent to backend.
 */

const config = require('../config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const onboardingService = require('./onboarding-service');
const crypto = require('crypto');
const { ValidationError, LedgerError } = require('../utils/ledgerError');

class WalletService {
  constructor() {
    this.jsonApiBase = config.canton.jsonApiBase;
    // In production, use database. For now, in-memory storage.
    // Maps walletId (partyId) -> { publicKeyBase64Der, partyId, allocatedAt }
    this.walletStore = new Map();
  }

  /**
   * Step 1: Generate topology transactions for external party
   * POST /v2/parties/external/generate-topology
   */
  async generateOnboardingMaterial({ displayName, partyHint, publicKeyBase64Der }) {
    const requestId = crypto.randomUUID();
    
    if (!displayName) {
      throw new ValidationError('displayName is required');
    }
    if (!publicKeyBase64Der) {
      throw new ValidationError('publicKeyBase64Der is required');
    }

    try {
      // Get service token for backend
      const token = await tokenProvider.getServiceToken();

      // Step 1: Get connected synchronizers
      const synchronizers = await cantonService.getSynchronizers(token);
      if (!synchronizers || synchronizers.length === 0) {
        throw new Error('No synchronizers available');
      }
      const synchronizerId = synchronizers[0].synchronizerId;

      // Step 2: Generate topology transactions
      const generateUrl = `${this.jsonApiBase}/v2/parties/external/generate-topology`;
      
      // Permission "Confirmation" ensures the external party can confirm (sign) transactions
      // but does not need to directly submit commands — the participant/validator does that.
      // This is required for external parties: the exchange submits commands,
      // the user's key is used for confirmation, ensuring all transactions have user authority.
      const generatePayload = {
        synchronizer: synchronizerId,
        partyHint: partyHint || `wallet-${Date.now()}`,
        publicKey: {
          format: "CRYPTO_KEY_FORMAT_DER_X509_SUBJECT_PUBLIC_KEY_INFO",
          keyData: publicKeyBase64Der,
          keySpec: "SIGNING_KEY_SPEC_EC_CURVE25519"
        },
        permission: 'Confirmation', // External party: user controls key, confirms transactions
        otherConfirmingParticipantUids: []
      };

      console.log(`[WalletService] Generating topology for: ${generatePayload.partyHint}`);

      const response = await fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(generatePayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new LedgerError('PARTY_TOPOLOGY_FAILED', `Topology generation failed: ${errorText}`);
      }

      const result = await response.json();

      console.log(`[WalletService] ✅ Topology generated: ${result.partyId}`);

      // Store public key for later signature verification
      this.walletStore.set(result.partyId, {
        publicKeyBase64Der,
        partyId: result.partyId,
        publicKeyFingerprint: result.publicKeyFingerprint,
        displayName,
        status: 'PENDING_ALLOCATION'
      });

      return {
        walletId: result.partyId, // This is the authoritative walletId
        partyId: result.partyId,
        publicKeyFingerprint: result.publicKeyFingerprint,
        multiHash: result.multiHash,
        topologyTransactions: result.topologyTransactions,
        onboardingTransactions: result.topologyTransactions, // Alias for compatibility
        synchronizerId,
        displayName
      };

    } catch (error) {
      console.error(`[WalletService] ❌ Onboarding generation failed:`, error.message);
      throw error;
    }
  }

  /**
   * Step 2: Allocate external party with user's signature
   * This completes the full onboarding: allocate party + create UserAccount + mint tokens
   * POST /v2/parties/external/allocate
   */
  async allocateExternalParty({
    partyId,
    synchronizerId,
    onboardingTransactions,
    multiHashSignature,
    publicKeyBase64,
    publicKeyFingerprint
  }) {
    const requestId = crypto.randomUUID();

    if (!partyId || !synchronizerId || !onboardingTransactions || !multiHashSignature) {
      throw new ValidationError('Missing required allocation parameters');
    }

    try {
      // Get wallet info to retrieve public key if not provided
      const walletInfo = this.walletStore.get(partyId);
      const effectivePublicKey = publicKeyBase64 || (walletInfo?.publicKeyBase64Der);
      
      if (!effectivePublicKey) {
        throw new ValidationError('Public key required for allocation');
      }

      // Extract signature from multiHashSignature object
      const signatureBase64 = typeof multiHashSignature === 'string' 
        ? multiHashSignature 
        : multiHashSignature.signature;

      // Use onboarding service to complete full flow (allocate + create UserAccount + mint)
      const result = await onboardingService.completeOnboarding(
        effectivePublicKey,
        signatureBase64,
        Array.isArray(onboardingTransactions) 
          ? onboardingTransactions.map(t => typeof t === 'string' ? t : t.transaction)
          : [],
        publicKeyFingerprint || walletInfo?.publicKeyFingerprint
      );

      // Update wallet store
      if (walletInfo) {
        walletInfo.status = 'ACTIVE';
        walletInfo.allocatedAt = new Date().toISOString();
        walletInfo.userAccountCreated = result.userAccountCreated;
        walletInfo.usdtMinted = result.usdtMinted;
      }

      console.log(`[WalletService] ✅ Party allocated and onboarded: ${partyId}`);

      return {
        walletId: partyId,
        partyId: result.partyId || partyId,
        status: 'ACTIVE',
        allocatedAt: new Date().toISOString(),
        userAccountCreated: result.userAccountCreated,
        usdtMinted: result.usdtMinted,
        walletContractId: result.userAccountResult?.transaction?.events?.[0]?.created?.contractId
      };

    } catch (error) {
      console.error(`[WalletService] ❌ Party allocation failed:`, error.message);
      throw error;
    }
  }

  /**
   * Verify Ed25519 signature
   */
  verifySignature(message, signatureBase64, publicKeyBase64) {
    try {
      const messageBuffer = Buffer.from(message, 'utf8');
      const signatureBuffer = Buffer.from(signatureBase64, 'base64');
      const publicKeyBuffer = Buffer.from(publicKeyBase64, 'base64');

      return crypto.verify(
        null,
        messageBuffer,
        publicKeyBuffer,
        signatureBuffer
      );
    } catch (error) {
      console.error('[WalletService] Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get party information
   * Returns both Canton party info and stored wallet metadata
   */
  async getPartyInfo(partyId) {
    try {
      const token = await tokenProvider.getServiceToken();
      const url = `${this.jsonApiBase}/v2/parties/${encodeURIComponent(partyId)}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Party info fetch failed: ${response.status}`);
      }

      const cantonInfo = await response.json();
      
      // Merge with stored wallet info
      const walletInfo = this.walletStore.get(partyId);
      
      return {
        ...cantonInfo,
        publicKeyBase64Der: walletInfo?.publicKeyBase64Der,
        publicKeyFingerprint: walletInfo?.publicKeyFingerprint,
        displayName: walletInfo?.displayName,
        status: walletInfo?.status,
        allocatedAt: walletInfo?.allocatedAt
      };
    } catch (error) {
      console.error(`[WalletService] Party info failed:`, error.message);
      throw error;
    }
  }
}

module.exports = new WalletService();
