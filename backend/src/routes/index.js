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

// Mount routes (matching existing API structure)
router.use('/orderbooks', orderBookRoutes);
router.use('/orders', orderRoutes);
router.use('/trades', tradeRoutes);
router.use('/admin', adminRoutes);
router.use('/create-party', partyRoutes); // DEPRECATED: returns 410 — use /api/onboarding/allocate-party (external parties)
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
// Legacy raw proxy (backwards compatibility)
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
// Rate-limited to prevent rapid-fire triggers causing duplicate matches on serverless.
let _lastMatchTriggerTime = 0;
const MATCH_COOLDOWN_MS = 30000; // 30 seconds between match cycles

const matchTriggerHandler = async (req, res) => {
  const now = Date.now();
  const elapsed = now - _lastMatchTriggerTime;
  
  // Rate limit: skip if less than 30s since last trigger (within same warm instance)
  if (elapsed < MATCH_COOLDOWN_MS) {
    const remaining = Math.ceil((MATCH_COOLDOWN_MS - elapsed) / 1000);
    console.log(`[MatchTrigger] Rate limited — ${remaining}s remaining`);
    return res.json({ ok: true, data: { success: false, reason: `rate_limited_${remaining}s` } });
  }
  
  _lastMatchTriggerTime = now;
  
  try {
    const { getMatchingEngine } = require('../services/matching-engine');
    const engine = getMatchingEngine();
    const targetPair = req.query?.pair || req.body?.pair || null;
    const result = await engine.triggerMatchingCycle(targetPair);
    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[MatchTrigger] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
};
router.post('/match/trigger', matchTriggerHandler);
router.get('/match/trigger', matchTriggerHandler); // For Vercel Cron

module.exports = router;
