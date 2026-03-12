/**
 * Wallet Routes - External Party Onboarding
 * 
 * These endpoints implement Canton's documented external party onboarding flow.
 * NO KEYCLOAK LOGIN REQUIRED FOR END-USERS.
 */

const express = require('express');
const router = express.Router();
const walletController = require('../../controllers/v1/walletController');
const { requireWalletAuth } = require('../../middleware/requireWalletAuth');

// ====================
// WALLET CREATION (Public endpoints)
// ====================

// POST /v1/wallets/create - Generate onboarding material
router.post('/create', walletController.createOnboardingMaterial);

// POST /v1/wallets/allocate - Allocate external party with signature
router.post('/allocate', walletController.allocateExternalParty);

// ====================
// WALLET INFO (Public endpoints)
// ====================

// GET /v1/wallets/:walletId - Get wallet information
router.get('/:walletId', walletController.getWalletInfo);

// ====================
// WALLET AUTHENTICATION
// ====================

// POST /v1/wallets/:walletId/challenge - Generate authentication challenge
router.post('/:walletId/challenge', walletController.generateChallenge);

// POST /v1/wallets/:walletId/unlock - Unlock wallet with signature
router.post('/:walletId/unlock', walletController.unlockWallet);

// ====================
// AUTHENTICATED ENDPOINTS
// ====================

// Example: Get wallet balance (requires authentication)
// router.get('/:walletId/balance', requireWalletAuth, walletController.getWalletBalance);

module.exports = router;
