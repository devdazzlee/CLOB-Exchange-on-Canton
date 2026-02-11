/**
 * Main Router
 * Combines all route modules
 */

const express = require('express');
const router = express.Router();

// Import route modules
const orderBookRoutes = require('./orderBookRoutes');
const orderRoutes = require('./orderRoutes');
const tradeRoutes = require('./tradeRoutes');
const adminRoutes = require('./adminRoutes');
const partyRoutes = require('./partyRoutes');
const onboardingRoutes = require('./onboardingRoutes');
const quotaRoutes = require('./quotaRoutes');
const authRoutes = require('./authRoutes');
const authController = require('../controllers/authController');
const healthRoutes = require('./healthRoutes');
const ledgerProxyRoutes = require('./ledgerProxyRoutes');
const ledgerRoutes = require('./ledgerRoutes');
const mintingRoutes = require('./mintingRoutes');
const balanceRoutes = require('./balanceRoutes');

// NEW: Wallet routes (External Party Onboarding - No Keycloak)
const walletRoutes = require('./v1/walletRoutes');
const exchangeRoutes = require('./v1/exchangeRoutes');
const simpleWalletRoutes = require('./walletRoutes'); // Simplified wallet creation

// TOKEN STANDARD V2 routes (Holdings + DvP Settlement)
const orderRoutesV2 = require('./orderRoutesV2');
const tradeRoutesV2 = require('./tradeRoutesV2');

// Debug middleware to log all incoming requests to this router
router.use((req, res, next) => {
  console.log(`[Routes Index] ${req.method} ${req.path} - Original URL: ${req.originalUrl}`);
  next();
});

// Mount routes (matching existing API structure)
router.use('/orderbooks', orderBookRoutes);
router.use('/orders', orderRoutes);
router.use('/trades', tradeRoutes);
router.use('/admin', adminRoutes);
router.use('/create-party', partyRoutes); // POST /api/create-party (legacy)
router.use('/onboarding', onboardingRoutes); // POST /api/onboarding/* (new external party flow)
router.use('/quota-status', quotaRoutes); // GET /api/quota-status
router.use('/token-exchange', authRoutes); // POST /api/token-exchange (legacy)
router.use('/auth', authRoutes); // NEW: POST /api/auth/challenge, /api/auth/verify
router.post('/inspect-token', authController.inspectToken); // POST /api/inspect-token
router.use('/ws/status', healthRoutes); // GET /api/ws/status
router.use('/health', healthRoutes); // GET /api/health
router.use('/balance', balanceRoutes); // GET /api/balance/:partyId
router.use('/transfers', require('./transferRoutes')); // Token transfer/accept offers (CBTC etc.)
// New BFF routes (no Keycloak / no Canton token in browser)
router.use('/ledger', ledgerProxyRoutes);
// Legacy raw proxy (kept for backwards compatibility / debugging)
router.use('/canton', ledgerRoutes);
router.use('/testnet', mintingRoutes); // Test token minting endpoints

// NEW: Simplified wallet routes
router.use('/wallet', simpleWalletRoutes); // POST /api/wallet/create, POST /api/wallet/allocate

// NEW: v1 API routes (External Party Onboarding + Exchange)
router.use('/v1/wallets', walletRoutes); // External party onboarding
router.use('/v1', exchangeRoutes); // Exchange API (orders, trades, etc.)

// TOKEN STANDARD V2 API (Holdings + DvP Settlement)
router.use('/orders/v2', orderRoutesV2); // POST /api/orders/v2 (Token Standard orders)
router.use('/trades/v2', tradeRoutesV2); // GET /api/trades/v2 (DvP trades)

// Matching Engine: On-demand trigger (CRITICAL for serverless/Vercel where background matching can't run)
// Supports both POST (from frontend) and GET (from Vercel Cron)
const matchTriggerHandler = async (req, res) => {
  try {
    const { getMatchingEngine } = require('../services/matching-engine');
    const engine = getMatchingEngine();
    const result = await engine.triggerMatchingCycle();
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[MatchTrigger] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
};
router.post('/match/trigger', matchTriggerHandler);
router.get('/match/trigger', matchTriggerHandler); // For Vercel Cron

// Debug: Log all registered routes
console.log('[Routes] Registered routes:');
console.log('  POST /api/create-party (legacy)');
console.log('  POST /api/onboarding/allocate-party (new 2-step)');
console.log('  POST /api/onboarding/ensure-rights');
console.log('  POST /api/onboarding/create-preapproval');
console.log('  GET  /api/onboarding/discover-synchronizer');
console.log('  GET  /api/quota-status');
console.log('  POST /api/token-exchange (legacy)');
console.log('  POST /api/auth/challenge - Get nonce to sign');
console.log('  POST /api/auth/verify - Verify signature, issue session token');
console.log('  POST /api/auth/refresh - Refresh session token');
console.log('  POST /api/inspect-token');
console.log('  GET  /api/ws/status');
console.log('  GET  /api/balance/:partyId');
console.log('  POST /api/balance/:partyId/mint');
console.log('  GET  /api/ledger/challenge');
console.log('  POST /api/ledger/query-active-contracts');
console.log('  POST /api/ledger/create');
console.log('  POST /api/ledger/exercise');
console.log('  GET  /api/ledger/connected-synchronizers');
console.log('  ALL  /api/canton/* (legacy proxy)');
console.log('  POST /api/testnet/mint-tokens');
console.log('  POST /api/testnet/quick-mint');
console.log('  GET  /api/testnet/balances/:partyId');
console.log('');
console.log('NEW Wallet API (Simplified - No Keycloak):');
console.log('  POST /api/wallet/create - Create wallet (step 1: generate topology)');
console.log('  POST /api/wallet/allocate - Allocate wallet (step 2: with signature)');
console.log('  GET  /api/wallet - Get current wallet info');
console.log('  GET  /api/wallet/:walletId - Get specific wallet info');
console.log('');
console.log('NEW v1 API (External Party Onboarding):');
console.log('  POST /api/v1/wallets/create - Generate onboarding material');
console.log('  POST /api/v1/wallets/allocate - Allocate external party');
console.log('  GET  /api/v1/wallets/:walletId - Get wallet info');
console.log('  POST /api/v1/wallets/:walletId/challenge - Generate auth challenge');
console.log('  POST /api/v1/wallets/:walletId/unlock - Unlock wallet with signature');
console.log('  POST /api/v1/orders - Place order (requires wallet auth)');
console.log('  GET  /api/v1/orders - List orders (requires wallet auth)');
console.log('  POST /api/v1/orders/:contractId/cancel - Cancel order (requires wallet auth)');
console.log('  GET  /api/v1/orderbook/:pair - Get orderbook (public)');
console.log('  GET  /api/v1/trades - Get trades (public)');
console.log('  GET  /api/v1/balances/:partyId - Get balances (requires wallet auth)');
console.log('');
console.log('TOKEN STANDARD V2 API (Holdings + DvP Settlement):');
console.log('  POST /api/orders/v2 - Place order (locks Holding)');
console.log('  GET  /api/orders/v2 - Get orders (OrderV3 contracts)');
console.log('  DELETE /api/orders/v2/:contractId - Cancel order (unlocks Holding)');
console.log('  GET  /api/orders/v2/orderbook/:pair - Get orderbook');
console.log('  GET  /api/balance/v2/:partyId - Get Holding-based balances');
console.log('  POST /api/balance/v2/mint - Mint Holdings (create tokens)');
console.log('  GET  /api/balance/v2/holdings/:partyId - List all Holdings');
console.log('  POST /api/balance/v2/lock - Lock a Holding');
console.log('  POST /api/balance/v2/unlock - Unlock a Holding');
console.log('  GET  /api/trades/v2 - Get trades (DvP settlements)');
console.log('  GET  /api/trades/v2/user/:partyId - Get user trades');
console.log('  GET  /api/trades/v2/pending-settlements - Admin view');

module.exports = router;
