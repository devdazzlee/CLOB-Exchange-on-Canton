/**
 * Trade Routes
 */

const express = require('express');
const router = express.Router();
const tradeController = require('../controllers/tradeController');

// GET /api/trades?limit=50 - All trades
router.get('/', tradeController.getAll);

// GET /api/trades/:pair - Trades by trading pair (e.g., BTC%2FUSDT)
// Must come BEFORE /user/:partyId to avoid conflicts
router.get('/:pair', (req, res, next) => {
  // If it looks like "user" path, skip to next route
  if (req.params.pair === 'user') {
    return next('route');
  }
  return tradeController.getByPair(req, res, next);
});

// GET /api/trades/user/:partyId?limit=200
router.get('/user/:partyId', tradeController.getForParty);

// GET /api/trades/party/:partyId?limit=200 — alias for /user/:partyId (frontend compatibility)
router.get('/party/:partyId', tradeController.getForParty);

module.exports = router;
