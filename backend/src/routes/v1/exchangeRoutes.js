/**
 * Exchange API v1 Routes
 * 
 * Production-grade API following the no-patches architecture:
 * Frontend → Exchange API → Canton JSON Ledger API
 * 
 * Routes match the OpenAPI spec in docs/openapi.yaml
 */

const express = require('express');
const router = express.Router();
const path = require('path');

// Fix the controller path - routes are in src/routes/v1, controller is in src/controllers/v1
const exchangeController = require('../../controllers/v1/exchangeController');
const { requireWalletAuth } = require('../../middleware/requireWalletAuth');

// ====================
// AUTH (no auth middleware needed)
// ====================

// POST /v1/auth/exchange - Exchange OIDC token for ledger token
router.post('/auth/exchange', exchangeController.exchangeToken);

// ====================
// WALLETS (requires wallet auth)
// ====================

// POST /v1/wallets - Create wallet and onboard party
router.post('/wallets', requireWalletAuth, exchangeController.createWallet);

// ====================
// ORDERS (requires wallet auth)
// ====================

// POST /v1/orders - Place a new order
router.post('/orders', requireWalletAuth, exchangeController.placeOrder);

// GET /v1/orders - List orders
router.get('/orders', requireWalletAuth, exchangeController.listOrders);

// POST /v1/orders/:contractId/cancel - Cancel an order
router.post('/orders/:contractId/cancel', requireWalletAuth, exchangeController.cancelOrder);

// ====================
// MARKET DATA (public)
// ====================

// GET /v1/orderbook/:pair - Get orderbook snapshot
router.get('/orderbook/:pair', exchangeController.getOrderbook);

// GET /v1/trades - Get recent trades
router.get('/trades', exchangeController.getTrades);

// GET /v1/tickers - Get market tickers
router.get('/tickers', exchangeController.getTickers);

// ====================
// BALANCES (requires wallet auth)
// ====================

// GET /v1/balances/:partyId - Get party balances
router.get('/balances/:partyId', requireWalletAuth, exchangeController.getBalances);

module.exports = router;
