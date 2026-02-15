/**
 * Balance Routes — Transfer Registry ONLY
 * 
 * ALL balance operations go through the Transfer Registry API
 * at http://65.108.40.104:8088. No Holdings fallback.
 * 
 * Supported instruments: CC, CBTC (case-sensitive).
 */

const express = require('express');
const router = express.Router();
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const { getTransferRegistry } = require('../services/transferRegistryClient');

// ─────────────────────────────────────────────────────────
// GET /api/balance/:partyId
// Primary balance endpoint — Transfer Registry only
// ─────────────────────────────────────────────────────────
router.get('/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance] Getting balance for party: ${partyId.substring(0, 30)}...`);
  
  const transferRegistry = getTransferRegistry();
  
  try {
    const trBalances = await transferRegistry.getAllBalances(partyId);
    
    const available = {};
    const locked = {};
    const total = {};
    
    for (const [sym, amt] of Object.entries(trBalances.available)) {
      available[sym] = parseFloat(amt) || 0;
    }
    for (const [sym, amt] of Object.entries(trBalances.locked)) {
      locked[sym] = parseFloat(amt) || 0;
    }
    for (const [sym, amt] of Object.entries(trBalances.total)) {
      total[sym] = parseFloat(amt) || 0;
    }

    console.log(`[Balance] Balances:`, available);

    return success(res, {
      partyId,
      balance: available,
      available,
      locked,
      total,
      holdings: [],
      tokenStandard: true,
      source: 'transfer-registry',
    }, 'Balances retrieved from Transfer Registry');
  } catch (err) {
    console.error(`[Balance] Transfer Registry query failed:`, err.message);
    return success(res, {
      partyId,
      balance: {},
      available: {},
      locked: {},
      total: {},
      holdings: [],
      tokenStandard: true,
      source: 'transfer-registry',
    }, 'No balances found');
  }
}));

// ─────────────────────────────────────────────────────────
// POST /api/balance/mint
// Mint tokens by transferring from faucet via Transfer Registry
// ─────────────────────────────────────────────────────────
router.post('/mint', asyncHandler(async (req, res) => {
  const { partyId, tokens } = req.body;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens)) {
    throw new ValidationError('Tokens array is required');
  }

  console.log(`[Balance] Minting for party: ${partyId.substring(0, 30)}...`, tokens);

  const transferRegistry = getTransferRegistry();
  const FAUCET_PARTY = process.env.FAUCET_PARTY_ID || 'faucet::1220faucet';
  
  const results = [];
  
  for (const tokenInfo of tokens) {
    try {
      const result = await transferRegistry.transfer({
        instrument: tokenInfo.symbol,
        fromParty: FAUCET_PARTY,
        toParty: partyId,
        amount: String(tokenInfo.amount),
        metadata: {
          type: 'faucet_mint',
          timestamp: new Date().toISOString(),
        },
      });
      results.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'minted',
        transactionHash: result.transactionHash,
      });
      console.log(`[Balance] Transferred ${tokenInfo.amount} ${tokenInfo.symbol} from faucet to ${partyId.substring(0, 30)}...`);
    } catch (err) {
      console.error(`[Balance] Failed to mint ${tokenInfo.symbol}:`, err.message);
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
    failed,
    tokenStandard: true,
    source: 'transfer-registry',
  }, `Minted ${successful.length}/${tokens.length} tokens`, 201);
}));

// ─────────────────────────────────────────────────────────
// V2 ENDPOINTS (same behavior — Transfer Registry only)
// ─────────────────────────────────────────────────────────

/**
 * GET /api/balance/v2/:partyId
 * Get balance — Transfer Registry only.
 */
router.get('/v2/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance V2] Getting balance for party: ${partyId.substring(0, 30)}...`);
  
  const transferRegistry = getTransferRegistry();
  
  try {
    const trBalances = await transferRegistry.getAllBalances(partyId);
    
    const available = {};
    const locked = {};
    const total = {};
    
    for (const [sym, amt] of Object.entries(trBalances.available)) {
      available[sym] = parseFloat(amt) || 0;
    }
    for (const [sym, amt] of Object.entries(trBalances.locked)) {
      locked[sym] = parseFloat(amt) || 0;
    }
    for (const [sym, amt] of Object.entries(trBalances.total)) {
      total[sym] = parseFloat(amt) || 0;
    }

    console.log(`[Balance V2] Balances for ${partyId.substring(0, 30)}...:`, available);

    return success(res, {
      partyId,
      balance: available,
      available,
      locked,
      total,
      holdings: [],
      source: 'transfer-registry',
      tokenStandard: true,
    }, 'Balances retrieved from Transfer Registry');
  } catch (err) {
    console.error('[Balance V2] Transfer Registry failed:', err.message);
    return success(res, {
      partyId,
      balance: {},
      available: {},
      locked: {},
      total: {},
      holdings: [],
      source: 'transfer-registry',
      tokenStandard: true,
    }, 'No balances found');
  }
}));

/**
 * POST /api/balance/v2/mint
 * Mint tokens via Transfer Registry faucet transfer.
 */
router.post('/v2/mint', asyncHandler(async (req, res) => {
  const { partyId, tokens } = req.body;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens)) {
    throw new ValidationError('Tokens array is required (e.g., [{ symbol: "CC", amount: 10000 }])');
  }

  console.log(`[Balance V2] Minting for party: ${partyId.substring(0, 30)}...`, tokens);

  const transferRegistry = getTransferRegistry();
  const FAUCET_PARTY = process.env.FAUCET_PARTY_ID || 'faucet::1220faucet';

  const results = [];
  
  for (const tokenInfo of tokens) {
    try {
      const result = await transferRegistry.transfer({
        instrument: tokenInfo.symbol,
        fromParty: FAUCET_PARTY,
        toParty: partyId,
        amount: String(tokenInfo.amount),
        metadata: {
          type: 'faucet_mint',
          timestamp: new Date().toISOString(),
        },
      });
      results.push({
        symbol: tokenInfo.symbol,
        amount: tokenInfo.amount,
        status: 'minted',
        transactionHash: result.transactionHash,
      });
      console.log(`[Balance V2] Transferred ${tokenInfo.amount} ${tokenInfo.symbol} from faucet to ${partyId.substring(0, 30)}...`);
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
    failed,
    tokenStandard: true,
    source: 'transfer-registry',
  }, `Minted ${successful.length}/${tokens.length} tokens`, 201);
}));

/**
 * GET /api/balance/v2/holdings/:partyId
 * Get balance summary from Transfer Registry (no individual holdings).
 */
router.get('/v2/holdings/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  const { symbol } = req.query;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance V2] Getting holdings for party: ${partyId.substring(0, 30)}...${symbol ? ` (${symbol})` : ''}`);

  const transferRegistry = getTransferRegistry();
  
  try {
    if (symbol) {
      // Single instrument query
      const balData = await transferRegistry.getBalance(partyId, symbol);
      const bal = balData.balance || {};
      return success(res, {
        partyId,
        symbol,
        holdings: [{
          type: 'transfer-registry',
          instrument: symbol,
          available: bal.available || '0',
          locked: bal.locked || '0',
          total: bal.total || '0',
        }],
        count: 1,
        totalAmount: parseFloat(bal.total || '0'),
        source: 'transfer-registry',
      }, `${symbol} balance from Transfer Registry`);
    }
    
    // All instruments
    const trBalances = await transferRegistry.getAllBalances(partyId);
    const holdings = [];
    const summary = {};
    
    for (const sym of Object.keys(trBalances.available)) {
      const avail = trBalances.available[sym] || '0';
      const lock = trBalances.locked[sym] || '0';
      const tot = trBalances.total[sym] || '0';
      
      holdings.push({
        type: 'transfer-registry',
        instrument: sym,
        available: avail,
        locked: lock,
        total: tot,
      });
      summary[sym] = parseFloat(avail) || 0;
    }
    
    return success(res, {
      partyId,
      holdings,
      count: holdings.length,
      summary,
      source: 'transfer-registry',
    }, `Found ${holdings.length} instruments`);
  } catch (err) {
    console.error('[Balance V2] Failed to get holdings:', err.message);
    return success(res, {
      partyId,
      holdings: [],
      count: 0,
      summary: {},
      source: 'transfer-registry',
    }, 'No holdings found');
  }
}));

/**
 * POST /api/balance/v2/lock
 * Lock funds via Transfer Registry API.
 */
router.post('/v2/lock', asyncHandler(async (req, res) => {
  const { lockReason, lockAmount, ownerPartyId, instrument } = req.body;
  
  if (!lockReason || !lockAmount || !ownerPartyId || !instrument) {
    throw new ValidationError('Required fields: instrument, lockReason, lockAmount, ownerPartyId');
  }

  console.log(`[Balance V2] Locking ${lockAmount} ${instrument} for ${ownerPartyId.substring(0, 30)}... (reason: ${lockReason})`);
  
  const transferRegistry = getTransferRegistry();
  
  try {
    const result = await transferRegistry.lockFunds({
      party: ownerPartyId,
      instrument,
      amount: String(lockAmount),
      reason: lockReason,
      expirySeconds: 86400,
    });
    
    return success(res, {
      lockId: result.lockId,
      instrument,
      lockReason,
      lockAmount: result.amount,
      remainingBalance: result.remainingBalance,
      source: 'transfer-registry',
    }, 'Funds locked via Transfer Registry');
  } catch (err) {
    console.error('[Balance V2] Lock failed:', err.message);
    return error(res, err.message, 500);
  }
}));

/**
 * POST /api/balance/v2/unlock
 * Unlock funds via Transfer Registry API.
 */
router.post('/v2/unlock', asyncHandler(async (req, res) => {
  const { lockId } = req.body;
  
  if (!lockId) {
    throw new ValidationError('lockId is required');
  }

  console.log(`[Balance V2] Unlocking lockId: ${lockId.substring(0, 30)}...`);
  
  const transferRegistry = getTransferRegistry();
  
  try {
    const result = await transferRegistry.unlockFunds(lockId);
    
    return success(res, {
      lockId: result.lockId,
      amount: result.amount,
      remainingBalance: result.remainingBalance,
      source: 'transfer-registry',
    }, 'Funds unlocked via Transfer Registry');
  } catch (err) {
    console.error('[Balance V2] Unlock failed:', err.message);
    return error(res, err.message, 500);
  }
}));

module.exports = router;
