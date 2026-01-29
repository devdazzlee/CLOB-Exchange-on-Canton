/**
 * Balance Routes - REAL Canton integration ONLY
 * No mock data or in-memory fallbacks
 */

const express = require('express');
const router = express.Router();
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const CantonLedgerClient = require('../services/cantonLedgerClient');

const cantonClient = new CantonLedgerClient();

/**
 * GET /api/balance/:partyId
 * Get REAL balance from Canton UserAccount contracts
 */
router.get('/:partyId', asyncHandler(async (req, res) => {
  const { partyId } = req.params;
  
  if (!partyId) {
    throw new ValidationError('Party ID is required');
  }

  console.log(`[Balance] Getting REAL balance for party: ${partyId}`);
  
  // Query UserAccount contracts from Canton
  const activeContracts = await cantonClient.getActiveContracts({
    parties: [partyId],
    templateIds: ['UserAccount:UserAccount']
  });

  if (!activeContracts.contractEntry || activeContracts.contractEntry.length === 0) {
    return error(res, 'User account not found', 404);
  }

  // Extract balance from UserAccount contract
  const userAccount = activeContracts.contractEntry[0].JsActiveContract.createdEvent;
  const balances = userAccount.argument.balances || [];

  // Convert balance array to object
  const availableBalances = {};
  const lockedBalances = {};

  balances.forEach(([token, amount]) => {
    availableBalances[token] = amount;
    lockedBalances[token] = '0'; // Would calculate from locked allocations
  });

  return success(res, {
    partyId,
    available: availableBalances,
    locked: lockedBalances,
    total: availableBalances // Same for now, would calculate real totals
  }, 'Real balances retrieved from Canton');
}));

/**
 * POST /api/balance/mint
 * Mint tokens by creating UserAccount with initial balance
 * NO MOCK MINTING - Real Canton contract creation
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

  // Create UserAccount contract with initial balance
  const command = {
    templateId: 'UserAccount:UserAccount',
    createArguments: {
      party: partyId,
      operator: config.canton.operatorPartyId,
      balances: tokens.map(token => [token.symbol, token.amount.toString()])
    }
  };

  const result = await cantonClient.submitAndWaitForTransaction({
    command,
    actAs: config.canton.operatorPartyId,
    readAs: [partyId]
  });

  // Extract created UserAccount contract ID
  const userAccountEvent = result.transaction.events.find(e => 
    e.CreatedEvent?.templateId.includes('UserAccount')
  );

  if (!userAccountEvent) {
    throw new Error('Token minting failed - no UserAccount contract created');
  }

  const contractId = userAccountEvent.CreatedEvent.contractId;
  console.log(`[Balance] Tokens minted successfully: ${contractId}`);

  return success(res, {
    partyId,
    contractId,
    tokens,
    status: 'minted'
  }, 'Tokens minted successfully on Canton', 201);
}));

module.exports = router;
