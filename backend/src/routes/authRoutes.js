/**
 * Auth Routes
 * 
 * Implements wallet-based authentication flow:
 * 1. POST /auth/challenge - Get nonce to sign
 * 2. POST /auth/verify - Verify signature, issue session token
 * 
 * NO KEYCLOAK LOGIN FOR END-USERS.
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Legacy: POST /api/token-exchange - Exchange Keycloak token (kept for backwards compatibility)
router.post('/', authController.exchangeToken);

// ====================
// NEW: Wallet-based authentication (NO KEYCLOAK FOR END-USERS)
// ====================

// POST /api/auth/challenge - Get nonce to sign
router.post('/challenge', authController.generateChallenge);

// POST /api/auth/verify - Verify signature, issue session token
router.post('/verify', authController.verifySignature);

// POST /api/auth/refresh - Refresh session token
router.post('/refresh', authController.refreshToken);

module.exports = router;
