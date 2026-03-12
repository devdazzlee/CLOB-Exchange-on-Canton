/**
 * Minting Routes - Token deposit endpoints
 * NO HARDCODED VALUES - All amounts from request or environment
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
 *   "partyId": "party-id-here",
 *   "tokens": [
 *     { "symbol": "BTC", "amount": 5.0 },
 *     { "symbol": "USDT", "amount": 50000.0 }
 *   ]
 * }
 */
router.post('/mint-tokens', mintingController.mintTestTokens);

/**
 * POST /api/testnet/quick-mint
 * Mint tokens using environment configuration or request body
 *
 * Body:
 * {
 *   "partyId": "party-id-here",
 *   "tokens": [{ "symbol": "BTC", "amount": 1.0 }]  // Optional - uses env config if not provided
 * }
 * 
 * Environment variables (if tokens not in request):
 * - MINT_BTC_AMOUNT
 * - MINT_ETH_AMOUNT
 * - MINT_SOL_AMOUNT
 * - MINT_USDT_AMOUNT
 */
router.post('/quick-mint', mintingController.quickMint);

/**
 * GET /api/testnet/balances/:partyId
 * Get user's current token balances from Canton
 */
router.get('/balances/:partyId', mintingController.getUserBalances);

/**
 * GET /api/testnet/configured-tokens
 * Get list of tokens configured in environment
 */
router.get('/configured-tokens', (req, res) => {
  res.json({
    success: true,
    data: mintingController.getConfiguredTokens(),
    message: 'Tokens configured from environment variables'
  });
});

module.exports = router;
