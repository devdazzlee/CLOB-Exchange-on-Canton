/**
 * Minting Routes - Test token faucet endpoints
 */

const express = require('express');
const router = express.Router();
const mintingController = require('../controllers/mintingController');

/**
 * POST /api/testnet/mint-tokens
 * Mint specific tokens with custom amounts
 *
 * Body:
 * {
 *   "partyId": "8100b2db-86cf-40a1-8351-55483c151cdc",
 *   "tokens": [
 *     { "symbol": "BTC", "amount": 5.0 },
 *     { "symbol": "USDT", "amount": 50000.0 }
 *   ]
 * }
 */
router.post('/mint-tokens', mintingController.mintTestTokens);

/**
 * POST /api/testnet/quick-mint
 * Mint default test token amounts
 *
 * Body:
 * {
 *   "partyId": "8100b2db-86cf-40a1-8351-55483c151cdc"
 * }
 *
 * Default amounts:
 * - BTC: 10.0
 * - ETH: 100.0
 * - SOL: 1000.0
 * - USDT: 100000.0
 */
router.post('/quick-mint', mintingController.quickMint);

/**
 * GET /api/testnet/balances/:partyId
 * Get user's current token balances
 */
router.get('/balances/:partyId', mintingController.getUserBalances);

/**
 * GET /api/testnet/default-tokens
 * Get list of default test tokens
 */
router.get('/default-tokens', (req, res) => {
  res.json({
    success: true,
    data: mintingController.getDefaultTestTokens()
  });
});

module.exports = router;
