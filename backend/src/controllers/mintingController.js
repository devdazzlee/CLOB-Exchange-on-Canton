/**
 * Minting Controller - Test token faucet for development
 * Allows users to mint test tokens for trading
 */

const cantonService = require('../services/cantonService');
const { broadcastBalanceUpdate } = require('../services/websocketService');
const config = require('../config');

function normalizeDecimal(value) {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') return value;
  return String(value);
}

function damlMapToObject(value) {
  if (Array.isArray(value)) {
    const obj = {};
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const [key, val] = entry;
        obj[key] = val;
        continue;
      }
      if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
        obj[entry.key] = entry.value;
      }
    }
    return obj;
  }
  if (value && typeof value === 'object') {
    return { ...value };
  }
  return {};
}

function objectToDamlMap(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([key, val]) => [key, normalizeDecimal(val)]);
}

/**
 * Discover synchronizer ID from Canton
 */
async function discoverSynchronizerId() {
  try {
    if (config.canton.synchronizerId) {
      return config.canton.synchronizerId;
    }

    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/connected-synchronizers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await cantonService.getAdminToken()}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      let synchronizerId = null;

      if (data.connectedSynchronizers && Array.isArray(data.connectedSynchronizers) && data.connectedSynchronizers.length > 0) {
        const synchronizers = data.connectedSynchronizers;
        const globalSync = synchronizers.find(s =>
          s.synchronizerAlias === 'global' || s.alias === 'global'
        );
        if (globalSync?.synchronizerId) {
          synchronizerId = globalSync.synchronizerId;
        } else {
          const globalDomainSync = synchronizers.find(s =>
            s.synchronizerId && s.synchronizerId.includes('global-domain')
          );
          synchronizerId = globalDomainSync?.synchronizerId || synchronizers[0].synchronizerId || synchronizers[0].id;
        }
      } else if (data.synchronizers && Array.isArray(data.synchronizers) && data.synchronizers.length > 0) {
        const first = data.synchronizers[0];
        synchronizerId = typeof first === 'string' ? first : (first.synchronizerId || first.id);
      } else if (data.synchronizerId) {
        synchronizerId = data.synchronizerId;
      } else if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        synchronizerId = typeof first === 'string' ? first : (first.synchronizerId || first.id);
      }

      if (synchronizerId) {
        return synchronizerId;
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
 * Creates or updates UserAccount balances with initial test tokens
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
    const operatorPartyId = config.canton.operatorPartyId;
    if (!operatorPartyId) {
      return res.status(500).json({
        success: false,
        error: 'Operator party ID not configured'
      });
    }

    // Check if user already has a UserAccount contract
    const adminToken = await cantonService.getAdminToken();
    await cantonService.ensurePartyRights(partyId, adminToken);
    const synchronizerId = await discoverSynchronizerId();

    const existingAccounts = await cantonService.queryContracts({
      templateId: 'UserAccount:UserAccount',
      filter: {
        party: partyId
      },
      party: partyId
    }, adminToken);

    let accountContractId;
    let currentBalances = {};

    // Get package ID for UserAccount (use package-id format to avoid vetting issues)
    const userAccountPackageId = await cantonService.getPackageIdForTemplate('UserAccount', adminToken);
    const userAccountTemplateId = `${userAccountPackageId}:UserAccount:UserAccount`;

    if (existingAccounts && existingAccounts.length > 0) {
      // Update existing UserAccount balances via Deposit
      const account = existingAccounts[0];
      accountContractId = account.contractId;
      currentBalances = damlMapToObject(account.payload.balances);

      console.log(`[Minting] Found existing UserAccount for ${partyId}:`, accountContractId);

      // Add requested tokens to current balances (local view)
      for (const token of tokens) {
        const { symbol } = token;
        const amountValue = Number(token.amount);
        const safeAmount = Number.isFinite(amountValue) ? amountValue : 0;
        const current = Number(currentBalances[symbol] ?? 0);
        currentBalances[symbol] = current + safeAmount;

        console.log(`[Minting] ${symbol}: ${current} + ${safeAmount} = ${currentBalances[symbol]}`);
      }

      // Exercise Deposit choice for each token (controller is party)
      for (const token of tokens) {
        await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: partyId,
          templateId: userAccountTemplateId,
          contractId: accountContractId,
          choice: 'Deposit',
          choiceArgument: {
            token: token.symbol,
            amount: normalizeDecimal(token.amount)
          },
          readAs: [partyId],
          synchronizerId,
        });

        const refreshedAccounts = await cantonService.queryContracts({
          templateId: 'UserAccount:UserAccount',
          filter: {
            party: partyId
          },
          party: partyId
        }, adminToken);
        if (refreshedAccounts && refreshedAccounts.length > 0) {
          accountContractId = refreshedAccounts[0].contractId;
        }
      }
    } else {
      // Create new UserAccount contract
      console.log(`[Minting] Creating new UserAccount for ${partyId}`);

      // Build initial balances map (Daml JSON expects array-of-pairs)
      const balancesMap = tokens.map((token) => [
        token.symbol,
        normalizeDecimal(token.amount)
      ]);
      for (const token of tokens) {
        currentBalances[token.symbol] = normalizeDecimal(token.amount);
      }

      const createResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: operatorPartyId,
        templateId: userAccountTemplateId,
        createArguments: {
          operator: operatorPartyId,
          party: partyId,
          balances: balancesMap,
        },
        readAs: [operatorPartyId],
        synchronizerId,
      });

      accountContractId = createResult.contractId;
    }

    // Query updated balance
    const updatedAccounts = await cantonService.queryContracts({
      templateId: 'UserAccount:UserAccount',
      filter: {
        party: partyId
      },
      party: partyId
    }, adminToken);

    const updatedAccount = updatedAccounts && updatedAccounts.length > 0 ? updatedAccounts[0] : null;
    const finalBalances = damlMapToObject(updatedAccount?.payload?.balances || currentBalances);
    const finalLocked = {};

    // Broadcast balance update to WebSocket clients
    broadcastBalanceUpdate(partyId, finalBalances, finalLocked);

    console.log(`[Minting] Broadcasted balance update for ${partyId}`);

    return res.json({
      success: true,
      message: 'Test tokens minted successfully',
      data: {
        partyId,
        accountContractId,
        holdingContractId: accountContractId,
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

    // Query user's UserAccount contract
    const adminToken = await cantonService.getAdminToken();
    await cantonService.ensurePartyRights(partyId, adminToken);
    const accounts = await cantonService.queryContracts({
      templateId: 'UserAccount:UserAccount',
      filter: {
        party: partyId
      },
      party: partyId
    }, adminToken);

    if (!accounts || accounts.length === 0) {
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

    const account = accounts[0];

    return res.json({
      success: true,
      data: {
        partyId,
        accountContractId: account.contractId,
        holdingContractId: account.contractId,
        balances: damlMapToObject(account.payload.balances),
        lockedBalances: {},
        lastUpdated: account.createdAt || new Date().toISOString()
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
