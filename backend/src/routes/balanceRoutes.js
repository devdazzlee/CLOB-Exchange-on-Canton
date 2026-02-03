/**
 * Balance Routes - REAL Canton integration ONLY
 * Queries actual UserAccount contracts from Canton ledger
 * NO HARDCODED DATA - All data from Canton API
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
 * Get REAL balance from Canton UserAccount contracts
 * NO FALLBACKS - Returns error if no UserAccount found
 */
router.get('/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance] Getting REAL balance for party: ${partyId}`);
  
  const token = await tokenProvider.getServiceToken();
  const packageId = config.canton.packageIds?.clobExchange;
  const operatorPartyId = config.canton.operatorPartyId;
  
  if (!packageId) {
    throw new Error('CLOB_EXCHANGE_PACKAGE_ID not configured');
  }
  
  // Query UserAccount contracts as OPERATOR (signatory)
  const contracts = await cantonService.queryActiveContracts({
    party: operatorPartyId,
    templateIds: [`${packageId}:UserAccount:UserAccount`],
    pageSize: 100
  }, token);
  
  // Find the UserAccount for this specific party
  const userAccountContract = (Array.isArray(contracts) ? contracts : [])
    .find(c => {
      const payload = c.payload || c.createArgument || {};
      return payload.party === partyId;
    });
  
  if (!userAccountContract) {
    // Return error - user needs to be onboarded first
    return error(res, 'No UserAccount found - user must complete onboarding first', 404);
  }
  
  // Extract balance from UserAccount contract - REAL DATA ONLY
  const payload = userAccountContract.payload || userAccountContract.createArgument || {};
  const balances = payload.balances || [];
  const contractId = userAccountContract.contractId;

  // Convert balance array to object - only include tokens that exist on ledger
  const availableBalances = {};
  balances.forEach(([tokenName, amount]) => {
    availableBalances[tokenName] = amount;
  });

  console.log(`[Balance] Found UserAccount for ${partyId.substring(0, 40)}...: ${JSON.stringify(availableBalances)}`);

  return success(res, {
    partyId,
    contractId,
    balance: availableBalances,
    available: availableBalances,
    locked: {}, // TODO: Calculate from open orders when needed
    total: availableBalances,
    source: 'canton'
  }, 'Real balances retrieved from Canton UserAccount');
}));

/**
 * POST /api/balance/mint
 * Mint tokens by creating/updating UserAccount
 * REAL Canton contract creation
 */
router.post('/mint', asyncHandler(async (req, res) => {
  const { partyId, tokens } = req.body;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens)) {
    throw new ValidationError('Tokens array is required');
  }

  console.log(`[Balance] Minting REAL tokens for party: ${partyId}`, tokens);

  const adminToken = await tokenProvider.getServiceToken();
  const packageId = config.canton.packageIds?.clobExchange;
  const operatorPartyId = config.canton.operatorPartyId;

  if (!packageId) {
    throw new Error('CLOB_EXCHANGE_PACKAGE_ID not configured');
  }

  // Check if user already has a UserAccount
  const contracts = await cantonService.queryActiveContracts({
    party: operatorPartyId,
    templateIds: [`${packageId}:UserAccount:UserAccount`],
    pageSize: 100
  }, adminToken);

  const existingAccount = (Array.isArray(contracts) ? contracts : [])
    .find(c => {
      const payload = c.payload || c.createArgument || {};
      return payload.party === partyId;
    });

  if (existingAccount) {
    // Deposit to existing account
    // IMPORTANT: After each Deposit, the contract is archived and a new one is created
    // So we must re-fetch the contract ID after each deposit
    let currentContractId = existingAccount.contractId;
    
    for (const tokenInfo of tokens) {
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: partyId,
        templateId: `${packageId}:UserAccount:UserAccount`,
        contractId: currentContractId,
        choice: 'Deposit',
        choiceArgument: {
          token: tokenInfo.symbol,
          amount: tokenInfo.amount.toString()
        },
        readAs: [operatorPartyId]
      });
      
      // Extract the new contract ID from the result (created by the exercise)
      if (result?.transaction?.events) {
        const createdEvent = result.transaction.events.find(e => 
          (e.created?.templateId?.includes('UserAccount')) || 
          (e.CreatedEvent?.templateId?.includes('UserAccount'))
        );
        const newContractId = createdEvent?.created?.contractId || 
                              createdEvent?.CreatedEvent?.contractId;
        if (newContractId) {
          currentContractId = newContractId;
          console.log(`[Balance] Deposit ${tokenInfo.symbol} complete, new contractId: ${newContractId.substring(0, 20)}...`);
        }
      }
    }

    return success(res, {
      partyId,
      contractId: currentContractId,
      tokens,
      status: 'deposited'
    }, 'Tokens deposited to existing UserAccount', 200);
  }

  // Create new UserAccount with initial balance
  const result = await cantonService.createContractWithTransaction({
    token: adminToken,
    actAsParty: operatorPartyId,
    templateId: `${packageId}:UserAccount:UserAccount`,
    createArguments: {
      party: partyId,
      operator: operatorPartyId,
      balances: tokens.map(t => [t.symbol, t.amount.toString()])
    },
    readAs: [partyId]
  });

  // Extract created contract ID
  let contractId = null;
  if (result.transaction?.events) {
    const createdEvent = result.transaction.events.find(e => 
      e.created?.templateId?.includes('UserAccount') || 
      e.CreatedEvent?.templateId?.includes('UserAccount')
    );
    contractId = createdEvent?.created?.contractId || 
                 createdEvent?.CreatedEvent?.contractId;
  }

  if (!contractId) {
    throw new Error('Token minting failed - no UserAccount contract created');
  }

  console.log(`[Balance] UserAccount created: ${contractId}`);

  return success(res, {
    partyId,
    contractId,
    tokens,
    status: 'minted'
  }, 'UserAccount created with tokens on Canton', 201);
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
