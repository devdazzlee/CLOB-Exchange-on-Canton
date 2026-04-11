/**
 * Wallet Controller - Simplified Wallet Creation
 * 
 * Implements the wallet creation flow:
 * - Backend creates party ID on behalf of user
 * - Backend generates ledger token
 * - Backend creates trading account
 * - NO KEYCLOAK LOGIN FOR END-USERS
 */

const crypto = require('crypto');
const OnboardingService = require('../services/onboarding-service');
const authService = require('../services/authService');
const userRegistry = require('../state/userRegistry');
const quota = require('../state/quota');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

const onboardingService = new OnboardingService();

class WalletController {
  /**
   * POST /wallet/create
   * Create wallet and allocate party for new user
   * 
   * This is the main entry point for wallet creation.
   * Backend handles everything - user never touches Keycloak.
   * 
   * Request body:
   * {
   *   "publicKey": "base64-encoded-ed25519-public-key",
   *   "displayName": "optional-display-name"
   * }
   * 
   * Response:
   * {
   *   "walletId": "wallet-abc123...",
   *   "partyId": "ext-abc123::1220...",
   *   "sessionToken": "jwt-token-for-api-calls",
   *   "expiresAt": "ISO timestamp"
   * }
   */
  createWallet = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { publicKey, displayName, partyHint } = req.body;

    if (!publicKey) {
      return error(res, 'publicKey is required (base64-encoded Ed25519 public key)', 400);
    }

    if (typeof publicKey !== 'string' || publicKey.trim() === '') {
      return error(res, 'publicKey must be a non-empty base64 string', 400);
    }

    try {
      // Check quota
      await quota.assertAvailable();

      // Generate wallet ID from public key (deterministic)
      const walletId = this.generateWalletId(publicKey);

      // Check if wallet already exists
      const existingUser = await userRegistry.getUser(walletId);
      if (existingUser && existingUser.partyId) {
        console.log(`[WalletController] Wallet already exists: ${walletId}`);
        
        // Return existing wallet info with new session token
        const sessionToken = authService.generateAppJWT({
          walletId,
          partyId: existingUser.partyId,
          sub: walletId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)
        });

        return success(res, {
          walletId,
          partyId: existingUser.partyId,
          sessionToken,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          isExisting: true
        }, 'Wallet already exists', 200);
      }

      console.log(`[WalletController] Creating new wallet: ${walletId}`);

      // Step 1: Generate topology
      const topologyResult = await onboardingService.generateTopology(
        publicKey,
        partyHint || walletId
      );

      console.log(`[WalletController] Topology generated for: ${topologyResult.partyHint}`);

      // For MVP: Return topology data for client-side signing
      // Client signs multiHash and calls /wallet/allocate with signature
      return success(res, {
        walletId,
        step: 'SIGN_REQUIRED',
        multiHash: topologyResult.multiHash,
        topologyTransactions: topologyResult.topologyTransactions,
        onboardingTransactions: topologyResult.onboardingTransactions,
        publicKeyFingerprint: topologyResult.publicKeyFingerprint,
        synchronizerId: topologyResult.synchronizerId,
        partyHint: topologyResult.partyHint,
        message: 'Sign the multiHash with your private key and call /wallet/allocate'
      }, 'Wallet creation step 1 complete - signature required', 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Wallet creation failed:`, err.message);
      const statusCode = err.statusCode || 500;
      return error(res, err.message, statusCode);
    }
  });

  /**
   * POST /wallet/allocate
   * Complete wallet allocation with user's signature
   * 
   * Request body:
   * {
   *   "publicKey": "base64-encoded-public-key",
   *   "signature": "base64-encoded-signature-of-multiHash",
   *   "topologyTransactions": [...],
   *   "publicKeyFingerprint": "fingerprint-from-step-1"
   * }
   */
  allocateWallet = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { 
      publicKey, 
      signature, 
      topologyTransactions, 
      onboardingTransactions,
      publicKeyFingerprint,
      partyHint
    } = req.body;

    if (!publicKey || !signature) {
      return error(res, 'publicKey and signature are required', 400);
    }

    const txs = topologyTransactions || onboardingTransactions;
    if (!txs || !Array.isArray(txs) || txs.length === 0) {
      return error(res, 'topologyTransactions required', 400);
    }

    if (!publicKeyFingerprint) {
      return error(res, 'publicKeyFingerprint required (from create step)', 400);
    }

    try {
      // Check quota
      await quota.assertAvailable();

      const walletId = this.generateWalletId(publicKey);

      console.log(`[WalletController] Allocating wallet: ${walletId}`);

      // Complete onboarding (allocate party + create UserAccount + mint tokens)
      const result = await onboardingService.completeOnboarding(
        publicKey,
        signature,
        txs,
        publicKeyFingerprint,
        partyHint
      );

      // Increment quota
      await quota.increment();

      // Store wallet mapping
      await userRegistry.upsertUser(walletId, {
        partyId: result.partyId,
        publicKeyBase64: publicKey,
        createdAt: Date.now()
      });

      // Generate session token
      const sessionToken = authService.generateAppJWT({
        walletId,
        partyId: result.partyId,
        sub: walletId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)
      });

      console.log(`[WalletController] ✅ Wallet allocated: ${walletId} -> ${result.partyId}`);

      return success(res, {
        walletId,
        partyId: result.partyId,
        sessionToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        userAccountCreated: result.userAccountCreated,
        usdtMinted: result.usdtMinted
      }, 'Wallet created successfully', 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Wallet allocation failed:`, err.message);
      const statusCode = err.statusCode || 500;
      return error(res, err.message, statusCode);
    }
  });

  /**
   * GET /wallet
   * Get current user's wallet info (requires auth header)
   */
  getWallet = asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Authorization header required', 401);
    }

    const token = authHeader.substring(7);
    const session = authService.verifySessionToken(token);

    if (!session) {
      return error(res, 'Invalid or expired session token', 401);
    }

    const user = await userRegistry.getUser(session.walletId);
    if (!user) {
      return error(res, 'Wallet not found', 404);
    }

    return success(res, {
      walletId: session.walletId,
      partyId: user.partyId,
      createdAt: user.createdAt,
      status: user.partyId ? 'ACTIVE' : 'PENDING'
    }, 'Wallet info retrieved', 200);
  });

  /**
   * GET /wallet/:walletId
   * Get specific wallet info
   */
  getWalletById = asyncHandler(async (req, res) => {
    const { walletId } = req.params;

    if (!walletId) {
      return error(res, 'walletId is required', 400);
    }

    const user = await userRegistry.getUser(walletId);
    if (!user) {
      return error(res, 'Wallet not found', 404);
    }

    return success(res, {
      walletId,
      partyId: user.partyId,
      createdAt: user.createdAt,
      status: user.partyId ? 'ACTIVE' : 'PENDING'
    }, 'Wallet info retrieved', 200);
  });

  /**
   * Generate wallet ID from public key (deterministic)
   */
  generateWalletId(publicKeyBase64) {
    const hash = crypto.createHash('sha256').update(publicKeyBase64).digest('hex');
    return `wallet-${hash.substring(0, 16)}`;
  }
}

module.exports = new WalletController();
