/**
 * Trade Routes V2 - Token Standard Version
 * 
 * Reads trades from Settlement:Trade contracts
 * Created by DvP settlement process
 */

const express = require('express');
const router = express.Router();
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const tokenProvider = require('../services/tokenProvider');
const { getSettlementService } = require('../services/settlementService');

/**
 * GET /api/trades/v2
 * Get all trades (from Settlement:Trade contracts)
 */
router.get('/', asyncHandler(async (req, res) => {
  const { pair, limit = 50 } = req.query;

  console.log(`[TradesV2] Getting trades${pair ? ` for ${pair}` : ''}`);

  const adminToken = await tokenProvider.getServiceToken();
  const settlementService = getSettlementService();
  await settlementService.initialize();

  const trades = await settlementService.getTrades(pair, parseInt(limit), adminToken);

  return success(res, {
    trades,
    count: trades.length,
    pair: pair || 'all',
    tokenStandard: true,
    source: 'Settlement:Trade',
  }, 'Trades retrieved');
}));

/**
 * GET /api/trades/v2/user/:partyId
 * Get trades for a specific user
 */
router.get('/user/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  const { limit = 50 } = req.query;

  if (!partyId) {
    throw new ValidationError('partyId is required');
  }

  console.log(`[TradesV2] Getting trades for ${partyId.substring(0, 30)}...`);

  const adminToken = await tokenProvider.getServiceToken();
  const settlementService = getSettlementService();
  await settlementService.initialize();

  const trades = await settlementService.getUserTrades(partyId, parseInt(limit), adminToken);

  return success(res, {
    partyId,
    trades,
    count: trades.length,
    tokenStandard: true,
    source: 'Settlement:Trade',
  }, 'User trades retrieved');
}));

/**
 * GET /api/trades/v2/pending-settlements
 * Get pending settlements (for admin monitoring)
 */
router.get('/pending-settlements', asyncHandler(async (req, res) => {
  console.log('[TradesV2] Getting pending settlements');

  const adminToken = await tokenProvider.getServiceToken();
  const settlementService = getSettlementService();
  await settlementService.initialize();

  const settlements = await settlementService.getPendingSettlements(adminToken);

  return success(res, {
    settlements,
    count: settlements.length,
    tokenStandard: true,
    source: 'Settlement:SettlementInstruction',
  }, 'Pending settlements retrieved');
}));

module.exports = router;
