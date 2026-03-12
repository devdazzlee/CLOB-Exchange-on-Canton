/**
 * Wallet Routes - Simplified Wallet Creation
 * 
 * These endpoints implement the simplified wallet creation flow:
 * 1. POST /wallet/create - Create wallet from public key
 * 2. GET /wallet - Get wallet info
 * 
 * NO KEYCLOAK LOGIN FOR END-USERS.
 */

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

// POST /api/wallet/create - Create wallet (step 1: generate topology)
router.post('/create', walletController.createWallet);

// POST /api/wallet/allocate - Allocate wallet (step 2: with signature)
router.post('/allocate', walletController.allocateWallet);

// GET /api/wallet - Get wallet info (requires auth)
router.get('/', walletController.getWallet);

// GET /api/wallet/:walletId - Get specific wallet info
router.get('/:walletId', walletController.getWalletById);

module.exports = router;
