/**
 * Transfer Routes - Handle token transfers from external sources
 * 
 * For accepting CBTC and other tokens from Canton DevNet faucet:
 * 1. User goes to https://utilities.dev.canton.wolfedgelabs.com/
 * 2. Navigate to: registry -> transfers
 * 3. Request CBTC for their partyId
 * 4. Accept the transfer-offer via this API
 */

const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getTransferOfferService } = require('../services/transferOfferService');
const tokenProvider = require('../services/tokenProvider');
const { success } = require('../utils/response');
const { ValidationError } = require('../middleware/errorHandler');

/**
 * GET /api/transfers/offers/:partyId
 * Get pending transfer offers for a party
 * 
 * Used to see if there are CBTC or other token offers waiting to be accepted
 */
router.get('/offers/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }
  
  console.log(`[Transfers] Getting transfer offers for: ${partyId.substring(0, 30)}...`);
  
  const adminToken = await tokenProvider.getServiceToken();
  const transferService = getTransferOfferService();
  await transferService.initialize();
  
  const offers = await transferService.getTransferOffers(partyId, adminToken);
  
  return success(res, {
    partyId,
    offerCount: offers.length,
    offers,
  }, `Found ${offers.length} transfer offer(s)`);
}));

/**
 * POST /api/transfers/accept
 * Accept a transfer offer (Splice Token Standard or custom)
 * 
 * Body: { offerContractId, partyId, templateId? }
 * 
 * For EXTERNAL parties: Returns { requiresSignature: true, preparedTransaction, preparedTransactionHash }
 *   → Frontend signs the hash, then calls POST /api/transfers/execute-accept
 * For INTERNAL parties: Accepts directly and returns { success: true }
 */
router.post('/accept', asyncHandler(async (req, res) => {
  const { offerContractId, partyId, templateId } = req.body;
  
  if (!offerContractId || !partyId) {
    throw new ValidationError('offerContractId and partyId are required');
  }
  
  console.log(`[Transfers] Accepting offer ${offerContractId.substring(0, 20)}... for ${partyId.substring(0, 30)}...`);
  if (templateId) {
    console.log(`[Transfers] Using template: ${templateId}`);
  }
  
  const adminToken = await tokenProvider.getServiceToken();
  const transferService = getTransferOfferService();
  await transferService.initialize();
  
  const result = await transferService.acceptTransferOffer(offerContractId, partyId, adminToken, templateId);
  
  // For external parties, the result includes requiresSignature: true
  // The frontend must sign preparedTransactionHash and call /execute-accept
  if (result.requiresSignature) {
    return success(res, {
      requiresSignature: true,
      preparedTransaction: result.preparedTransaction,
      preparedTransactionHash: result.preparedTransactionHash,
      hashingSchemeVersion: result.hashingSchemeVersion,
      hashingDetails: result.hashingDetails,
      offerContractId: result.offerContractId,
      partyId: result.partyId,
    }, 'Transaction prepared. Sign the hash and call /execute-accept.');
  }
  
  return success(res, result, 'Transfer offer accepted successfully');
}));

/**
 * POST /api/transfers/prepare-accept
 * STEP 1: Prepare transfer accept for interactive signing
 * 
 * Body: { offerContractId, partyId, templateId? }
 * Returns: { preparedTransaction, preparedTransactionHash, ... }
 * 
 * The frontend must sign preparedTransactionHash with the user's Ed25519 private key,
 * then call /execute-accept with the signature.
 */
router.post('/prepare-accept', asyncHandler(async (req, res) => {
  const { offerContractId, partyId, templateId } = req.body;
  
  if (!offerContractId || !partyId) {
    throw new ValidationError('offerContractId and partyId are required');
  }
  
  console.log(`[Transfers] PREPARE accept: ${offerContractId.substring(0, 20)}... for ${partyId.substring(0, 30)}...`);
  
  const adminToken = await tokenProvider.getServiceToken();
  const transferService = getTransferOfferService();
  await transferService.initialize();
  
  const result = await transferService.prepareTransferAccept(offerContractId, partyId, adminToken, templateId);
  
  return success(res, {
    preparedTransaction: result.preparedTransaction,
    preparedTransactionHash: result.preparedTransactionHash,
    hashingSchemeVersion: result.hashingSchemeVersion,
    hashingDetails: result.hashingDetails,
    offerContractId: result.offerContractId,
    partyId: result.partyId,
  }, 'Transaction prepared for signing');
}));

/**
 * POST /api/transfers/execute-accept
 * STEP 2: Execute prepared transfer accept with user's signature
 * 
 * Body: { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion? }
 * 
 * signatureBase64: User's Ed25519 signature of the preparedTransactionHash
 * signedBy: The public key fingerprint (from onboarding) that signed
 * hashingSchemeVersion: From the prepare response (echoed back)
 */
router.post('/execute-accept', asyncHandler(async (req, res) => {
  const { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion } = req.body;
  
  if (!preparedTransaction || !partyId || !signatureBase64 || !signedBy) {
    throw new ValidationError('preparedTransaction, partyId, signatureBase64, and signedBy are required');
  }
  
  console.log(`[Transfers] EXECUTE accept for ${partyId.substring(0, 30)}... signedBy: ${signedBy.substring(0, 20)}...`);
  
  const adminToken = await tokenProvider.getServiceToken();
  const transferService = getTransferOfferService();
  await transferService.initialize();
  
  const result = await transferService.executeTransferAccept(
    preparedTransaction, partyId, signatureBase64, signedBy, adminToken, hashingSchemeVersion
  );
  
  return success(res, result, 'Transfer accepted via interactive submission');
}));

/**
 * GET /api/transfers/external-tokens
 * List all external tokens available on the network
 * 
 * This shows tokens like CBTC that aren't created by our CLOB
 * but are available on Canton DevNet
 */
router.get('/external-tokens', asyncHandler(async (req, res) => {
  console.log('[Transfers] Listing external tokens...');
  
  const adminToken = await tokenProvider.getServiceToken();
  const transferService = getTransferOfferService();
  await transferService.initialize();
  
  const tokens = await transferService.listExternalTokens(adminToken);
  
  return success(res, {
    tokenCount: tokens.length,
    tokens,
  }, 'External tokens listed');
}));

/**
 * GET /api/transfers/cbtc-instructions
 * Get instructions for requesting CBTC from the faucet
 */
router.get('/cbtc-instructions', asyncHandler(async (req, res) => {
  return success(res, {
    title: 'How to get CBTC (Canton Bitcoin) for testing',
    steps: [
      {
        step: 1,
        action: 'Go to Canton DevNet Utilities',
        url: 'https://utilities.dev.canton.wolfedgelabs.com/',
      },
      {
        step: 2,
        action: 'Navigate to Registry -> Transfers',
        description: 'In the utilities UI, find the registry section and click on transfers',
      },
      {
        step: 3,
        action: 'Request CBTC for your PartyID',
        description: 'You should see a transfer-offer of CBTC available to accept for your party ID',
        partyIdExample: 'Your party ID looks like: external-wallet-user-xxx::122087fa...',
      },
      {
        step: 4,
        action: 'Accept the transfer offer',
        description: 'Click accept on the transfer-offer, or use this API: POST /api/transfers/accept',
        apiBody: {
          offerContractId: 'the-contract-id-from-utilities-ui',
          partyId: 'your-full-party-id',
        },
      },
      {
        step: 5,
        action: 'Verify your CBTC balance',
        description: 'Check your holdings via: GET /api/balance/:partyId',
      },
    ],
    notes: [
      'CBTC is a test token on Canton DevNet representing Bitcoin',
      'After accepting, your Holdings will include CBTC',
      'You can then trade CBTC on the CLOB exchange',
    ],
  }, 'CBTC faucet instructions');
}));

module.exports = router;
