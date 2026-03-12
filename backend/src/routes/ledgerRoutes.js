/**
 * Ledger Routes
 * Proxy routes for Canton Ledger API
 */

const express = require('express');
const router = express.Router();
const TokenExchangeService = require('../services/token-exchange');

const tokenExchange = new TokenExchangeService();

// All /api/ledger/* routes are proxied to Canton
router.all('*', async (req, res) => {
  await tokenExchange.proxyLedgerApiCall(req, res);
});

module.exports = router;
