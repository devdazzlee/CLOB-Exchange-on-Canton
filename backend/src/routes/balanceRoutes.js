/**
 * Balance Routes - TOKEN STANDARD (Holdings) ONLY
 * Uses real Holding contracts from Canton ledger
 * NO UserAccount/text balances - Token Standard only
 */

const express = require('express');
const router = express.Router();
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const config = require('../config');
const cantonService = require('../services/cantonService');
const tokenProvider = require('../services/tokenProvider');
const { getHoldingService } = require('../services/holdingService');
const { getInstrumentService } = require('../services/instrumentService');

/**
 * GET /api/balance/:partyId
 * Get REAL balance from Holdings (Token Standard)
 * Redirects to V2 endpoint for Token Standard
 */
router.get('/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance] TOKEN STANDARD: Getting Holdings for party: ${partyId}`);
  
  const token = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  await holdingService.initialize();
  
  try {
    const balances = await holdingService.getBalances(partyId, token);
    
    console.log(`[Balance] Found ${Object.keys(balances.available).length} tokens in Holdings`);

    return success(res, {
      partyId,
      balance: balances.available,
      available: balances.available,
      locked: balances.locked || {},
      total: balances.total || balances.available,
      holdings: balances.holdings,
      tokenStandard: true,
      source: 'holdings'
    }, 'Token Standard balances retrieved from Holdings');
  } catch (err) {
    console.error(`[Balance] Failed to get Holdings:`, err.message);
    // Return empty balances if no Holdings found
  return success(res, {
    partyId,
      balance: {},
      available: {},
      locked: {},
      total: {},
      holdings: [],
      tokenStandard: true,
      source: 'holdings'
    }, 'No Holdings found - mint tokens first');
  }
}));

/**
 * POST /api/balance/mint
 * TOKEN STANDARD: Mint tokens by creating Holding contracts
 * Redirects to V2 Holdings-based minting
 */
router.post('/mint', asyncHandler(async (req, res) => {
  const { partyId, tokens } = req.body;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens)) {
    throw new ValidationError('Tokens array is required');
  }

  console.log(`[Balance] TOKEN STANDARD: Minting Holdings for party: ${partyId}`, tokens);

  const adminToken = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  await holdingService.initialize();
  
  const minted = [];
  
  for (const tokenInfo of tokens) {
    try {
      await holdingService.mintDirect(
        partyId,
        tokenInfo.symbol,
        tokenInfo.amount,
        adminToken
      );
      minted.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'minted'
      });
      console.log(`[Balance] Minted ${tokenInfo.amount} ${tokenInfo.symbol} for ${partyId.substring(0, 30)}...`);
    } catch (err) {
      console.error(`[Balance] Failed to mint ${tokenInfo.symbol}:`, err.message);
      minted.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'failed',
        error: err.message
      });
    }
  }

  return success(res, {
    partyId,
    minted,
    tokenStandard: true,
    source: 'holdings'
  }, 'Tokens minted as Holdings (Token Standard)', 201);
}));

// ============================================================
// NEW TOKEN STANDARD ENDPOINTS (Using Holdings)
// ============================================================

/**
 * GET /api/balance/v2/:partyId
 * Get balance using the new Holding-based token standard
 * Returns available, locked, and total balances from Holdings
 */
router.get('/v2/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance V2] Getting Holdings-based balance for party: ${partyId}`);
  
  const token = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  
  try {
    const balances = await holdingService.getBalances(partyId, token);
    
    console.log(`[Balance V2] Found balances for ${partyId.substring(0, 30)}...:`, balances.available);

    return success(res, {
      partyId,
      balance: balances.available,
      available: balances.available,
      locked: balances.locked,
      total: balances.total,
      holdings: balances.holdings,
      source: 'holdings',
      tokenStandard: true,
    }, 'Real balances retrieved from Holdings');
  } catch (err) {
    console.error('[Balance V2] Failed:', err.message);
    // Return empty balances if no Holdings found (new user)
    return success(res, {
      partyId,
      balance: {},
      available: {},
      locked: {},
      total: {},
      holdings: [],
      source: 'holdings',
      tokenStandard: true,
    }, 'No Holdings found - mint tokens to get started');
  }
}));

/**
 * POST /api/balance/v2/mint
 * Mint tokens using the new Holding-based token standard
 * Creates actual Holding contracts
 */
router.post('/v2/mint', asyncHandler(async (req, res) => {
  const { partyId, tokens } = req.body;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens)) {
    throw new ValidationError('Tokens array is required (e.g., [{ symbol: "USDT", amount: 10000 }])');
  }

  console.log(`[Balance V2] Minting Holdings for party: ${partyId}`, tokens);

  const adminToken = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  
  const results = [];
  
  for (const tokenInfo of tokens) {
    try {
      const result = await holdingService.mintDirect(
        partyId,
        tokenInfo.symbol,
        tokenInfo.amount,
        adminToken
      );
      
      results.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'minted',
        contractId: result.events?.[0]?.created?.contractId,
      });
      
      console.log(`[Balance V2] Minted ${tokenInfo.amount} ${tokenInfo.symbol} for ${partyId.substring(0, 30)}...`);
    } catch (err) {
      console.error(`[Balance V2] Failed to mint ${tokenInfo.symbol}:`, err.message);
      results.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'failed',
        error: err.message,
      });
    }
  }

  const successful = results.filter(r => r.status === 'minted');
  const failed = results.filter(r => r.status === 'failed');

  return success(res, {
    partyId,
    minted: successful,
    failed: failed,
    tokenStandard: true,
    source: 'holdings',
  }, `Minted ${successful.length}/${tokens.length} tokens as Holdings`, 201);
}));

/**
 * GET /api/balance/v2/holdings/:partyId
 * Get detailed Holdings list for a party
 */
router.get('/v2/holdings/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  const { symbol } = req.query;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance V2] Getting Holdings for party: ${partyId}${symbol ? ` (${symbol})` : ''}`);
  
  const token = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  
  try {
    if (symbol) {
      // Get specific symbol's Holdings
      const holdings = await holdingService.getAvailableHoldings(partyId, symbol, token);
      return success(res, {
        partyId,
        symbol,
        holdings,
        count: holdings.length,
        totalAmount: holdings.reduce((sum, h) => sum + h.amount, 0),
      }, `Found ${holdings.length} Holdings for ${symbol}`);
    }
    
    // Get all Holdings
    const balances = await holdingService.getBalances(partyId, token);
    return success(res, {
      partyId,
      holdings: balances.holdings,
      count: balances.holdings.length,
      summary: balances.available,
    }, `Found ${balances.holdings.length} total Holdings`);
  } catch (err) {
    console.error('[Balance V2] Failed to get holdings:', err.message);
    return error(res, err.message, 500);
  }
}));

/**
 * POST /api/balance/v2/lock
 * Lock a Holding for an order
 */
router.post('/v2/lock', asyncHandler(async (req, res) => {
  const { holdingCid, lockHolder, lockReason, lockAmount, ownerPartyId } = req.body;
  
  if (!holdingCid || !lockHolder || !lockReason || !lockAmount || !ownerPartyId) {
    throw new ValidationError('All fields required: holdingCid, lockHolder, lockReason, lockAmount, ownerPartyId');
  }

  console.log(`[Balance V2] Locking Holding ${holdingCid.substring(0, 30)}... for: ${lockReason}`);
  
  const token = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  
  try {
    const result = await holdingService.lockHolding(
      holdingCid,
      lockHolder,
      lockReason,
      parseFloat(lockAmount),
      ownerPartyId,
      token
    );
    
    return success(res, {
      originalHoldingCid: holdingCid,
      lockedHoldingCid: result.events?.[0]?.created?.contractId,
      lockReason,
      lockAmount,
    }, 'Holding locked successfully');
  } catch (err) {
    console.error('[Balance V2] Failed to lock holding:', err.message);
    return error(res, err.message, 500);
  }
}));

/**
 * POST /api/balance/v2/unlock
 * Unlock a Holding (cancel order)
 */
router.post('/v2/unlock', asyncHandler(async (req, res) => {
  const { holdingCid, ownerPartyId } = req.body;
  
  if (!holdingCid || !ownerPartyId) {
    throw new ValidationError('holdingCid and ownerPartyId are required');
  }

  console.log(`[Balance V2] Unlocking Holding ${holdingCid.substring(0, 30)}...`);
  
  const token = await tokenProvider.getServiceToken();
  const holdingService = getHoldingService();
  
  try {
    const result = await holdingService.unlockHolding(holdingCid, ownerPartyId, token);

  return success(res, {
      originalHoldingCid: holdingCid,
      unlockedHoldingCid: result.events?.[0]?.created?.contractId,
    }, 'Holding unlocked successfully');
  } catch (err) {
    console.error('[Balance V2] Failed to unlock holding:', err.message);
    return error(res, err.message, 500);
  }
}));

module.exports = router;
