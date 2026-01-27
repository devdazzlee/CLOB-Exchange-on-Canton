/**
 * Balance Routes
 * Provides balance endpoints for testing
 */

const express = require('express');
const router = express.Router();

// Mock balance data for testing
const mockBalances = {
  'default': {
    BTC: '10.0',
    USDT: '100000.0',
    ETH: '100.0',
    SOL: '1000.0'
  }
};

/**
 * GET /api/balance/:partyId
 * Get balance for a specific party
 */
router.get('/:partyId', (req, res) => {
  const { partyId } = req.params;
  
  console.log(`[Balance] Getting balance for party: ${partyId}`);
  
  // For testing, return mock balance for any party
  const balance = mockBalances.default;
  
  res.json({
    success: true,
    data: {
      partyId,
      balance
    }
  });
});

/**
 * POST /api/balance/:partyId/mint
 * Mint additional tokens for testing
 */
router.post('/:partyId/mint', (req, res) => {
  const { partyId } = req.params;
  const { tokens } = req.body || {};
  
  console.log(`[Balance] Minting tokens for party: ${partyId}`, tokens);
  
  // Return minted tokens
  const mintedBalance = tokens || mockBalances.default;
  
  res.json({
    success: true,
    data: {
      partyId,
      balance: mintedBalance,
      message: 'Tokens minted successfully'
    }
  });
});

module.exports = router;
