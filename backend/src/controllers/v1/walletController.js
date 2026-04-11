/**
 * Wallet Controller - External Party Onboarding
 * 
 * Implements the documented Canton external party onboarding flow.
 * NO KEYCLOAK LOGIN FOR END-USERS.
 */

const crypto = require('crypto');
const walletService = require('../../services/walletService');
const authService = require('../../services/authService');
const asyncHandler = require('../../middleware/asyncHandler');
const { ValidationError, LedgerError } = require('../../utils/ledgerError');

/**
 * Generate structured API response
 */
function success(res, data, meta = null, statusCode = 200) {
  const response = {
    ok: true,
    data
  };
  if (meta) {
    response.meta = meta;
  }
  return res.status(statusCode).json(response);
}

/**
 * Generate error response
 */
function error(res, err, requestId) {
  const statusCode = err.getHttpStatus ? err.getHttpStatus() : 500;
  return res.status(statusCode).json({
    ok: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    },
    meta: { requestId }
  });
}

class WalletController {
  /**
   * POST /v1/wallets/create
   * Generate onboarding material for external party
   */
  createOnboardingMaterial = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { displayName, partyHint, publicKeyBase64Der } = req.body;

    try {
      const result = await walletService.generateOnboardingMaterial({
        displayName,
        partyHint,
        publicKeyBase64Der
      });

      return success(res, result, { requestId }, 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Onboarding creation failed:`, err.message);
      return error(res, err, requestId);
    }
  });

  /**
   * POST /v1/wallets/allocate
   * Allocate external party with user signature
   * Completes full onboarding: allocate party + create UserAccount + mint 10,000 USDT
   */
  allocateExternalParty = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const {
      partyId,
      synchronizerId,
      onboardingTransactions,
      multiHashSignature,
      publicKeyBase64,
      publicKeyFingerprint
    } = req.body;

    try {
      const result = await walletService.allocateExternalParty({
        partyId,
        synchronizerId,
        onboardingTransactions,
        multiHashSignature,
        publicKeyBase64,
        publicKeyFingerprint
      });

      return success(res, result, { requestId }, 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Party allocation failed:`, err.message);
      return error(res, err, requestId);
    }
  });

  /**
   * GET /v1/wallets/:walletId
   * Get wallet information
   */
  getWalletInfo = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { walletId } = req.params;

    if (!walletId) {
      throw new ValidationError('walletId is required');
    }

    try {
      const partyInfo = await walletService.getPartyInfo(walletId);
      
      if (!partyInfo) {
        return res.status(404).json({
          ok: false,
          error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
          meta: { requestId }
        });
      }

      return success(res, {
        walletId,
        partyId: partyInfo.party,
        isLocal: partyInfo.isLocal,
        metadata: partyInfo.localMetadata
      }, { requestId });

    } catch (err) {
      console.error(`[WalletController] ❌ Wallet info failed:`, err.message);
      return error(res, err, requestId);
    }
  });

  /**
   * POST /v1/wallets/:walletId/challenge
   * Generate authentication challenge
   */
  generateChallenge = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { walletId } = req.params;

    if (!walletId) {
      throw new ValidationError('walletId is required');
    }

    try {
      const result = await authService.generateChallenge(walletId);
      return success(res, result, { requestId }, 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Challenge generation failed:`, err.message);
      return error(res, err, requestId);
    }
  });

  /**
   * POST /v1/wallets/:walletId/unlock
   * Verify signature and issue session token
   */
  unlockWallet = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { walletId } = req.params;
    const { nonce, signatureBase64 } = req.body;

    if (!nonce || !signatureBase64) {
      throw new ValidationError('nonce and signatureBase64 are required');
    }

    try {
      const result = await authService.unlockWallet({
        walletId,
        nonce,
        signatureBase64
      });

      return success(res, result, { requestId }, 200);

    } catch (err) {
      console.error(`[WalletController] ❌ Wallet unlock failed:`, err.message);
      return error(res, err, requestId);
    }
  });
}

module.exports = new WalletController();
