/**
 * Ledger Proxy Routes (BFF)
 * Mounted at: /api/ledger
 */

const express = require('express');
const router = express.Router();

const requireUserId = require('../middleware/requireUserId');
const asyncHandler = require('../middleware/asyncHandler');
const ledgerProxyController = require('../controllers/ledgerProxyController');

router.use(requireUserId);

// Challenge for wallet-signed requests (MVP)
router.get('/challenge', (req, res) => ledgerProxyController.issueChallenge(req, res));

// Ledger operations (proxied via backend)
router.post('/query-active-contracts', asyncHandler(ledgerProxyController.queryActiveContracts));
router.post('/fetch-contract', asyncHandler(ledgerProxyController.fetchContract));
router.post('/fetch-contracts', asyncHandler(ledgerProxyController.fetchContracts));
router.post('/create', asyncHandler(ledgerProxyController.create));
router.post('/exercise', asyncHandler(ledgerProxyController.exercise));

// Optional
router.get('/connected-synchronizers', asyncHandler(ledgerProxyController.connectedSynchronizers));

module.exports = router;


