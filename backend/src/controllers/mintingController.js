/**
 * Minting Controller - Test token faucet for development
 * Allows users to mint test tokens for trading
 */

const cantonService = require('../services/cantonService');
const { broadcastBalanceUpdate } = require('../services/websocketService');
const config = require('../config');

/**
 * Discover synchronizer ID from Canton
 */
async function discoverSynchronizerId() {
  try {
    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/connected-synchronizers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await cantonService.getAdminToken()}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const synchronizers = data.synchronizers || [];
      if (synchronizers.length > 0) {
        return synchronizers[0]; // Return first synchronizer
      }
    }
    throw new Error('No synchronizers found');
  } catch (error) {
    console.error('[MintingController] Failed to discover synchronizer:', error);
    throw error;
  }
}

/**
 * Mint test tokens for a user
 * Creates or updates AssetHolding contract with initial balances
 */
async function mintTestTokens(req, res) {
  try {
    const { partyId, tokens } = req.body;

    // Validate input
    if (!partyId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: partyId'
      });
    }

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tokens array. Expected: [{symbol: "BTC", amount: 1.0}, ...]'
      });
    }

    console.log(`[Minting] User ${partyId} requesting tokens:`, tokens);

    // Get operator party ID from environment
    const operatorPartyId = process.env.OPERATOR_PARTY_ID;
    if (!operatorPartyId) {
      return res.status(500).json({
        success: false,
        error: 'Operator party ID not configured'
      });
    }

    // Check if user already has an AssetHolding contract
    const existingHoldings = await cantonService.queryContracts({
      templateId: 'AssetHolding',
      filter: {
        party: partyId
      }
    });

    let holdingContractId;
    let currentAssets = {};
    let currentLocked = {};

    if (existingHoldings && existingHoldings.length > 0) {
      // Update existing holding
      const holding = existingHoldings[0];
      holdingContractId = holding.contractId;
      currentAssets = holding.payload.assets || {};
      currentLocked = holding.payload.lockedAssets || {};

      console.log(`[Minting] Found existing holding for ${partyId}:`, holdingContractId);

      // Add requested tokens to current balances
      for (const token of tokens) {
        const { symbol, amount } = token;
        const current = currentAssets[symbol] || 0;
        currentAssets[symbol] = current + amount;

        console.log(`[Minting] ${symbol}: ${current} + ${amount} = ${currentAssets[symbol]}`);
      }

      // Exercise UpdateAvailable choice for each token
      for (const token of tokens) {
        const updateResult = await cantonService.exerciseChoice({
          token: await cantonService.getAdminToken(),
          actAsParty: operatorPartyId,
          templateId: '#clob-exchange-splice:AssetHolding:AssetHolding',
          contractId: holdingContractId,
          choice: 'UpdateAvailable',
          choiceArgument: {
            symbol: token.symbol,
            delta: token.amount
          },
          readAs: [operatorPartyId],
          synchronizerId: await discoverSynchronizerId(),
        });

        if (updateResult && updateResult.contractId) {
          holdingContractId = updateResult.contractId;
        }
      }

    } else {
      // Create new AssetHolding contract
      console.log(`[Minting] Creating new holding for ${partyId}`);

      // Build initial assets map
      for (const token of tokens) {
        currentAssets[token.symbol] = token.amount;
      }

      const createResult = await cantonService.createContract({
        token: await cantonService.getAdminToken(),
        actAsParty: operatorPartyId,
        templateId: '#clob-exchange-splice:AssetHolding:AssetHolding',
        createArguments: {
          operator: operatorPartyId,
          party: partyId,
          assets: currentAssets,
          lockedAssets: {}
        },
        readAs: [operatorPartyId],
        synchronizerId: await discoverSynchronizerId(),
      });

      holdingContractId = createResult.contractId;
    }

    // Query updated balance
    const updatedHolding = await cantonService.fetchContract(holdingContractId);

    const finalBalances = updatedHolding?.payload?.assets || currentAssets;
    const finalLocked = updatedHolding?.payload?.lockedAssets || currentLocked;

    // Broadcast balance update to WebSocket clients
    broadcastBalanceUpdate(partyId, finalBalances, finalLocked);

    console.log(`[Minting] Broadcasted balance update for ${partyId}`);

    return res.json({
      success: true,
      message: 'Test tokens minted successfully',
      data: {
        partyId,
        holdingContractId,
        balances: finalBalances,
        lockedBalances: finalLocked,
        mintedTokens: tokens
      }
    });

  } catch (error) {
    console.error('[Minting] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to mint test tokens'
    });
  }
}

/**
 * Get user's current balances
 */
async function getUserBalances(req, res) {
  try {
    const { partyId } = req.params;

    if (!partyId) {
      return res.status(400).json({
        success: false,
        error: 'Missing partyId parameter'
      });
    }

    // Query user's AssetHolding contract
    const holdings = await cantonService.queryContracts({
      templateId: 'AssetHolding',
      filter: {
        party: partyId
      }
    });

    if (!holdings || holdings.length === 0) {
      return res.json({
        success: true,
        data: {
          partyId,
          balances: {},
          lockedBalances: {},
          totalValue: 0
        }
      });
    }

    const holding = holdings[0];

    return res.json({
      success: true,
      data: {
        partyId,
        holdingContractId: holding.contractId,
        balances: holding.payload.assets || {},
        lockedBalances: holding.payload.lockedAssets || {},
        lastUpdated: holding.createdAt || new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Minting] Error fetching balances:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch balances'
    });
  }
}

/**
 * Get default test token amounts
 */
function getDefaultTestTokens() {
  return [
    { symbol: 'BTC', amount: 10.0 },
    { symbol: 'ETH', amount: 100.0 },
    { symbol: 'SOL', amount: 1000.0 },
    { symbol: 'USDT', amount: 100000.0 }
  ];
}

/**
 * Quick mint - Mint default test tokens
 */
async function quickMint(req, res) {
  try {
    const { partyId } = req.body;

    if (!partyId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: partyId'
      });
    }

    // Use default amounts
    const tokens = getDefaultTestTokens();

    // Reuse the mintTestTokens logic
    req.body.tokens = tokens;
    return await mintTestTokens(req, res);

  } catch (error) {
    console.error('[Minting] Quick mint error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to quick mint'
    });
  }
}

module.exports = {
  mintTestTokens,
  getUserBalances,
  quickMint,
  getDefaultTestTokens
};
