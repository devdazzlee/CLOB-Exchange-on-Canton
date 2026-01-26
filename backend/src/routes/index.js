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
router.use('/token-exchange', authRoutes); // POST /api/token-exchange
router.post('/inspect-token', authController.inspectToken); // POST /api/inspect-token
router.use('/ws/status', healthRoutes); // GET /api/ws/status
// New BFF routes (no Keycloak / no Canton token in browser)
router.use('/ledger', ledgerProxyRoutes);
// Legacy raw proxy (kept for backwards compatibility / debugging)
router.use('/canton', ledgerRoutes);
router.use('/testnet', mintingRoutes); // Test token minting endpoints

// Debug: Log all registered routes
console.log('[Routes] Registered routes:');
console.log('  POST /api/create-party (legacy)');
console.log('  POST /api/onboarding/allocate-party (new 2-step)');
console.log('  POST /api/onboarding/ensure-rights');
console.log('  POST /api/onboarding/create-preapproval');
console.log('  GET  /api/onboarding/discover-synchronizer');
console.log('  GET  /api/quota-status');
console.log('  POST /api/token-exchange');
console.log('  POST /api/inspect-token');
console.log('  GET  /api/ws/status');
console.log('  GET  /api/ledger/challenge');
console.log('  POST /api/ledger/query-active-contracts');
console.log('  POST /api/ledger/create');
console.log('  POST /api/ledger/exercise');
console.log('  GET  /api/ledger/connected-synchronizers');
console.log('  ALL  /api/canton/* (legacy proxy)');
console.log('  POST /api/testnet/mint-tokens');
console.log('  POST /api/testnet/quick-mint');
console.log('  GET  /api/testnet/balances/:partyId');

module.exports = router;
