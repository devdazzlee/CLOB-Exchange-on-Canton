/**
 * Holding Service - Manages token Holdings (proper token standard)
 * 
 * Holdings are the actual token ownership contracts (like UTXOs).
 * This replaces the text-based balance map in UserAccount.
 * 
 * Key concepts:
 * - Instrument: Defines a token type (symbol, decimals, issuer)
 * - Holding: Actual ownership of tokens (amount + optional lock)
 * - Holdings can be locked for orders, split for partial fills
 */

const { getCantonService } = require('./cantonService');
const config = require('../config');

// Template IDs for token standard contracts
const getTemplateIds = () => {
  const packageId = config.packageId || process.env.CLOB_EXCHANGE_PACKAGE_ID;
  return {
    instrument: `${packageId}:Instrument:Instrument`,
    tradingPair: `${packageId}:Instrument:TradingPair`,
    holding: `${packageId}:Holding:Holding`,
    transferProposal: `${packageId}:Holding:TransferProposal`,
    mintRequest: `${packageId}:Holding:MintRequest`,
    order: `${packageId}:OrderV3:Order`,
    orderRequest: `${packageId}:OrderV3:OrderRequest`,
    settlement: `${packageId}:Settlement:SettlementInstruction`,
    trade: `${packageId}:Settlement:Trade`,
  };
};

class HoldingService {
  constructor() {
    this.cantonService = null;
  }

  async initialize() {
    this.cantonService = getCantonService();
    console.log('[HoldingService] Initialized with token standard support');
  }

  /**
   * Get all Holdings for a party
   * Returns aggregated balances by instrument
   */
  async getBalances(partyId, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();

    try {
      // Query all Holding contracts for this party
      const holdings = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: [templateIds.holding],
      }, token);

      // Aggregate by instrument symbol
      const balances = {};
      const lockedBalances = {};
      const holdingDetails = [];

      for (const holding of holdings) {
        const payload = holding.payload;
        const symbol = payload.instrumentId?.symbol || 'UNKNOWN';
        const amount = parseFloat(payload.amount) || 0;
        const isLocked = payload.lock !== null && payload.lock !== undefined;
        const lockedAmount = isLocked ? (parseFloat(payload.lock?.lockedAmount) || amount) : 0;

        // Track available (unlocked) balance
        if (!isLocked) {
          balances[symbol] = (balances[symbol] || 0) + amount;
        }

        // Track locked balance
        if (isLocked) {
          lockedBalances[symbol] = (lockedBalances[symbol] || 0) + lockedAmount;
        }

        // Store details for UI
        holdingDetails.push({
          contractId: holding.contractId,
          symbol,
          amount: amount.toString(),
          locked: isLocked,
          lockedAmount: lockedAmount.toString(),
          lockReason: payload.lock?.lockReason || null,
          instrumentId: payload.instrumentId,
        });
      }

      return {
        available: balances,
        locked: lockedBalances,
        total: Object.keys(balances).reduce((acc, symbol) => {
          acc[symbol] = ((balances[symbol] || 0) + (lockedBalances[symbol] || 0)).toString();
          return acc;
        }, {}),
        holdings: holdingDetails,
      };
    } catch (error) {
      console.error('[HoldingService] Failed to get balances:', error.message);
      throw error;
    }
  }

  /**
   * Get available (unlocked) Holdings for a specific instrument
   * Used when placing orders to find collateral
   */
  async getAvailableHoldings(partyId, symbol, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();

    try {
      const holdings = await cantonService.queryActiveContracts({
        party: partyId,
        templateIds: [templateIds.holding],
      }, token);

      // Filter for matching symbol and unlocked
      return holdings
        .filter(h => {
          const payload = h.payload;
          return payload.instrumentId?.symbol === symbol &&
                 (payload.lock === null || payload.lock === undefined);
        })
        .map(h => ({
          contractId: h.contractId,
          amount: parseFloat(h.payload.amount) || 0,
          instrumentId: h.payload.instrumentId,
        }))
        .sort((a, b) => b.amount - a.amount); // Largest first
    } catch (error) {
      console.error('[HoldingService] Failed to get available holdings:', error.message);
      throw error;
    }
  }

  /**
   * Create a MintRequest to mint new tokens
   * Returns the MintRequest contract ID (operator must execute)
   */
  async createMintRequest(partyId, symbol, amount, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      // First, find or create the Instrument
      const instrumentId = {
        issuer: operatorPartyId,
        symbol: symbol,
        version: '1.0',
      };

      const result = await cantonService.submitCommand({
        token,
        actAs: [partyId],
        readAs: [partyId, operatorPartyId],
        commands: [{
          CreateCommand: {
            templateId: templateIds.mintRequest,
            createArguments: {
              requestor: partyId,
              instrumentId: instrumentId,
              amount: amount.toString(),
              recipient: partyId,
              custodian: operatorPartyId,
            },
          },
        }],
      });

      console.log('[HoldingService] MintRequest created:', result);
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to create mint request:', error.message);
      throw error;
    }
  }

  /**
   * Execute a MintRequest (operator only) - creates actual Holding
   */
  async executeMintRequest(mintRequestCid, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const result = await cantonService.exerciseChoice({
        token,
        templateId: templateIds.mintRequest,
        contractId: mintRequestCid,
        choice: 'MintRequest_Execute',
        choiceArgument: {},
        actAsParty: operatorPartyId,
      });

      console.log('[HoldingService] MintRequest executed, Holding created');
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to execute mint request:', error.message);
      throw error;
    }
  }

  /**
   * Mint tokens directly (operator privilege)
   * Creates Holding contract directly without MintRequest flow
   */
  async mintDirect(partyId, symbol, amount, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const instrumentId = {
        issuer: operatorPartyId,
        symbol: symbol,
        version: '1.0',
      };

      const result = await cantonService.submitCommand({
        token: adminToken,
        actAs: [operatorPartyId],
        readAs: [operatorPartyId, partyId],
        commands: [{
          CreateCommand: {
            templateId: templateIds.holding,
            createArguments: {
              owner: partyId,
              instrumentId: instrumentId,
              amount: amount.toString(),
              lock: null,
              custodian: operatorPartyId,
            },
          },
        }],
      });

      console.log(`[HoldingService] Minted ${amount} ${symbol} for ${partyId}`);
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to mint directly:', error.message);
      throw error;
    }
  }

  /**
   * Lock a Holding for an order
   */
  async lockHolding(holdingCid, lockHolder, lockReason, lockAmount, ownerPartyId, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();

    try {
      const result = await cantonService.exerciseChoice({
        token,
        templateId: templateIds.holding,
        contractId: holdingCid,
        choice: 'Holding_Lock',
        choiceArgument: {
          lockHolder: lockHolder,
          lockReason: lockReason,
          lockAmount: lockAmount.toString(),
        },
        actAsParty: ownerPartyId,
      });

      console.log('[HoldingService] Holding locked for:', lockReason);
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to lock holding:', error.message);
      throw error;
    }
  }

  /**
   * Unlock a Holding (cancel order)
   */
  async unlockHolding(holdingCid, ownerPartyId, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();

    try {
      const result = await cantonService.exerciseChoice({
        token,
        templateId: templateIds.holding,
        contractId: holdingCid,
        choice: 'Holding_Unlock',
        choiceArgument: {},
        actAsParty: ownerPartyId,
      });

      console.log('[HoldingService] Holding unlocked');
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to unlock holding:', error.message);
      throw error;
    }
  }

  /**
   * Transfer holding to another party
   */
  async transferHolding(holdingCid, newOwner, amount, ownerPartyId, token) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();

    try {
      const result = await cantonService.exerciseChoice({
        token,
        templateId: templateIds.holding,
        contractId: holdingCid,
        choice: 'Holding_Transfer',
        choiceArgument: {
          newOwner: newOwner,
          transferAmount: amount.toString(),
        },
        actAsParty: ownerPartyId,
      });

      console.log('[HoldingService] Transfer proposal created');
      return result;
    } catch (error) {
      console.error('[HoldingService] Failed to transfer holding:', error.message);
      throw error;
    }
  }

  /**
   * Find sufficient Holdings to cover an amount
   * Returns list of Holdings to use and any excess
   */
  async findHoldingsForAmount(partyId, symbol, requiredAmount, token) {
    const holdings = await this.getAvailableHoldings(partyId, symbol, token);
    
    let totalFound = 0;
    const selectedHoldings = [];
    
    for (const holding of holdings) {
      if (totalFound >= requiredAmount) break;
      
      selectedHoldings.push(holding);
      totalFound += holding.amount;
    }

    if (totalFound < requiredAmount) {
      throw new Error(`Insufficient ${symbol} balance. Required: ${requiredAmount}, Available: ${totalFound}`);
    }

    return {
      holdings: selectedHoldings,
      totalAmount: totalFound,
      excess: totalFound - requiredAmount,
    };
  }
}

// Singleton instance
let holdingServiceInstance = null;

function getHoldingService() {
  if (!holdingServiceInstance) {
    holdingServiceInstance = new HoldingService();
  }
  return holdingServiceInstance;
}

module.exports = {
  HoldingService,
  getHoldingService,
};
