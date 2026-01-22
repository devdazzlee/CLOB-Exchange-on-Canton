/**
 * Onboarding Controller
 * Handles external party onboarding HTTP requests
 */

const OnboardingService = require('../services/onboarding-service');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class OnboardingController {
  constructor() {
    this.onboardingService = new OnboardingService();
  }

  /**
   * 2-step allocate party endpoint
   *
   * STEP 1: Generate topology
   * Request: { publicKeyBase64, partyHint? }
   * Response: { step: "TOPOLOGY", multiHash, topologyTransactions, onboardingTransactions, ... }
   *
   * STEP 2: Allocate party
   * Request: { publicKeyBase64, signatureBase64, topologyTransactions }
   * Response: { step: "ALLOCATED", partyId, synchronizerId }
   */
  allocateParty = asyncHandler(async (req, res) => {
    // Accept both publicKey and publicKeyBase64 for compatibility
    let publicKeyBase64 = req.body.publicKeyBase64 || req.body.publicKey;
    // Accept both signature and signatureBase64 for compatibility
    const signatureBase64 = req.body.signatureBase64 || req.body.signature;
    const { topologyTransactions, onboardingTransactions, partyHint, publicKeyFingerprint } = req.body;

    // Validate publicKeyBase64 is always required and must be a string
    if (!publicKeyBase64) {
      return error(res, 'publicKeyBase64 or publicKey is required (base64 string)', 400);
    }

    // If publicKeyBase64 is an object, reject it (backend must construct the publicKey object)
    if (typeof publicKeyBase64 !== 'string') {
      return error(res, 'publicKeyBase64 must be a base64 string, not an object. Backend will construct the publicKey object internally.', 400);
    }

    // Ensure it's not empty after trimming
    if (publicKeyBase64.trim() === '') {
      return error(res, 'publicKeyBase64 cannot be empty', 400);
    }

    // Determine which step based on presence of signature
    const isStep2 = !!signatureBase64;

    if (isStep2) {
      // STEP 2: Allocate party
      console.log('[OnboardingController] Step 2: Allocate party');

      // Accept either topologyTransactions or onboardingTransactions
      const txs = topologyTransactions || onboardingTransactions;

      if (!txs || !Array.isArray(txs) || txs.length === 0) {
        return error(res, 'topologyTransactions or onboardingTransactions required for step 2', 400);
      }

      // Validate signature
      if (!signatureBase64) {
        return error(res, 'signatureBase64 or signature is required for step 2', 400);
      }
      if (typeof signatureBase64 !== 'string') {
        return error(res, 'signatureBase64 must be a base64 string', 400);
      }
      if (signatureBase64.trim() === '') {
        return error(res, 'signatureBase64 cannot be empty', 400);
      }

      // Validate publicKeyFingerprint
      if (!publicKeyFingerprint) {
        return error(res, 'publicKeyFingerprint is required for step 2 (from generate-topology response)', 400);
      }
      if (typeof publicKeyFingerprint !== 'string' || publicKeyFingerprint.trim() === '') {
        return error(res, 'publicKeyFingerprint must be a non-empty string', 400);
      }

      // Debug log the parameters being passed to the service
      console.log('[OnboardingController] Step 2 parameters:', {
        publicKeyBase64: publicKeyBase64 ? `${publicKeyBase64.substring(0, 20)}...` : 'missing',
        signatureBase64: signatureBase64 ? `${signatureBase64.substring(0, 20)}...` : 'missing',
        publicKeyFingerprint: publicKeyFingerprint ? `${publicKeyFingerprint.substring(0, 20)}...` : 'missing',
        transactionsCount: txs ? txs.length : 0,
      });

      try {
        const result = await this.onboardingService.allocateParty(
          publicKeyBase64,
          signatureBase64,
          txs,
          publicKeyFingerprint
        );

        return success(res, result, 'Party allocated successfully', 200);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return error(res, err.message, statusCode, err.cause);
      }
    } else {
      // STEP 1: Generate topology
      console.log('[OnboardingController] Step 1: Generate topology');

      try {
        const result = await this.onboardingService.generateTopology(
          publicKeyBase64,
          partyHint
        );

        return success(res, result, 'Topology generated successfully', 200);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return error(res, err.message, statusCode, err.cause);
      }
    }
  });

  /**
   * Ensure rights endpoint (NO-OP for external party flow)
   * Validator token already has actAs rights
   */
  ensureRights = asyncHandler(async (req, res) => {
    const { partyId } = req.body;

    if (!partyId) {
      return error(res, 'partyId is required', 400);
    }

    const result = await this.onboardingService.ensureRights(partyId);
    return success(res, result, 'Rights verification successful', 200);
  });

  /**
   * Create preapproval endpoint (optional/not required)
   * Returns success without blocking
   */
  createPreapproval = asyncHandler(async (req, res) => {
    const { partyId } = req.body;

    if (!partyId) {
      return error(res, 'partyId is required', 400);
    }

    const result = await this.onboardingService.createPreapproval(partyId);
    return success(res, result, 'Preapproval successful', 200);
  });

  /**
   * Discover synchronizerId
   * Useful for debugging and frontend to show which synchronizer is being used
   */
  discoverSynchronizer = asyncHandler(async (req, res) => {
    const synchronizerId = await this.onboardingService.discoverSynchronizerId();
    return success(res, { synchronizerId }, 'Synchronizer discovered successfully', 200);
  });
}

module.exports = new OnboardingController();
