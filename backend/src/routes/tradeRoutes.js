/**
 * Trade Routes
 */

const express = require('express');
const router = express.Router();
const tradeController = require('../controllers/tradeController');

// GET /api/trades?limit=50
router.get('/', tradeController.getAll);

// GET /api/trades/user/:partyId?limit=200
router.get('/user/:partyId', tradeController.getForParty);

module.exports = router;
