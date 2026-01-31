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
    for (const tokenInfo of tokens) {
      await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: partyId,
        templateId: `${packageId}:UserAccount:UserAccount`,
        contractId: existingAccount.contractId,
        choice: 'Deposit',
        choiceArgument: {
          token: tokenInfo.symbol,
          amount: tokenInfo.amount.toString()
        },
        readAs: [operatorPartyId]
      });
    }

    return success(res, {
      partyId,
      contractId: existingAccount.contractId,
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

module.exports = router;
