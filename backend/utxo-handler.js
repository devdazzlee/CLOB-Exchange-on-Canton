/**
 * Comprehensive UTXO Handler for Canton's UTXO Model
 * 
 * Handles UTXO merging for:
 * 1. Order placement - merges UTXOs before placing orders if needed
 * 2. Order cancellation - merges UTXOs after cancellation
 * 3. Partial fills - merges UTXOs after partial order fills
 * 
 * Problem: Canton operates on UTXO model
 * - User has 100 CC
 * - Places order for 50 CC (UTXO locked)
 * - Cancels order (UTXO released but separate)
 * - Cannot place order for 51 CC (UTXOs not merged)
 * 
 * Solution: Automatic UTXO merging at critical points
 */

const UTXOMerger = require('./utxo-merger');
const CantonAdmin = require('./canton-admin');

class UTXOHandler {
  constructor() {
    this.utxoMerger = new UTXOMerger();
    this.cantonAdmin = new CantonAdmin();
  }

  /**
   * Get UserAccount contract for a party
   * @param {string} partyId - Party ID
   * @param {string} adminToken - Admin token
   * @returns {Promise<object|null>} UserAccount contract or null
   */
  async getUserAccount(partyId, adminToken) {
    try {
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
      
      const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: "0",
          filter: {
            filtersForAnyParty: {
              inclusive: {
                templateIds: ['UserAccount:UserAccount']
              }
            }
          }
        })
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const contracts = Array.isArray(data) ? data : (data.activeContracts || []);
      
      // Find UserAccount for this party
      for (const contract of contracts) {
        const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                           contract.createdEvent || 
                           contract;
        const party = contractData.createArgument?.party || contractData.argument?.party;
        
        if (party === partyId) {
          return {
            contractId: contractData.contractId,
            balances: contractData.createArgument?.balances || contractData.argument?.balances || {},
            party: party
          };
        }
      }

      return null;
    } catch (error) {
      console.error('[UTXO Handler] Error getting UserAccount:', error.message);
      return null;
    }
  }

  /**
   * Get total balance for a token (sum of all UTXOs)
   * @param {object} userAccount - UserAccount contract
   * @param {string} token - Token symbol
   * @returns {number} Total balance
   */
  getTotalBalance(userAccount, token) {
    if (!userAccount || !userAccount.balances) {
      return 0;
    }

    // In DAML, balances is a Map, but in JSON it's an object
    // If it's an object, get the value directly
    if (typeof userAccount.balances === 'object' && !Array.isArray(userAccount.balances)) {
      return parseFloat(userAccount.balances[token] || 0);
    }

    // If it's an array (Map representation), find the token
    if (Array.isArray(userAccount.balances)) {
      const tokenEntry = userAccount.balances.find(entry => 
        entry.key === token || entry[0] === token
      );
      return tokenEntry ? parseFloat(tokenEntry.value || tokenEntry[1] || 0) : 0;
    }

    return 0;
  }

  /**
   * Check if user has sufficient balance (considering UTXO fragmentation)
   * If balance is fragmented, attempt to merge UTXOs
   * @param {string} partyId - Party ID
   * @param {string} token - Token symbol
   * @param {number} requiredAmount - Required amount
   * @returns {Promise<{sufficient: boolean, merged: boolean, userAccount: object|null}>}
   */
  async checkAndMergeBalance(partyId, token, requiredAmount) {
    try {
      const adminToken = await this.cantonAdmin.getAdminToken();
      const userAccount = await this.getUserAccount(partyId, adminToken);

      if (!userAccount) {
        return {
          sufficient: false,
          merged: false,
          userAccount: null,
          reason: 'UserAccount not found'
        };
      }

      const totalBalance = this.getTotalBalance(userAccount, token);

      // If total balance is sufficient, check if we need to merge
      if (totalBalance >= requiredAmount) {
        // Try to merge UTXOs to ensure we can use the full balance
        // This is best-effort - if merge fails, we still proceed (may work if UTXOs are already merged)
        try {
          await this.utxoMerger.mergeUTXOs(partyId, token, userAccount.contractId);
          console.log(`[UTXO Handler] Merged UTXOs for ${partyId}, token: ${token}`);
          
          // Re-fetch UserAccount after merge
          const updatedAccount = await this.getUserAccount(partyId, adminToken);
          
          return {
            sufficient: true,
            merged: true,
            userAccount: updatedAccount || userAccount,
            totalBalance: updatedAccount ? this.getTotalBalance(updatedAccount, token) : totalBalance
          };
        } catch (mergeError) {
          // Merge failed, but balance might still be sufficient
          console.warn(`[UTXO Handler] UTXO merge failed (non-critical):`, mergeError.message);
          return {
            sufficient: true,
            merged: false,
            userAccount: userAccount,
            totalBalance: totalBalance,
            warning: 'UTXO merge failed, but balance may still be sufficient'
          };
        }
      }

      return {
        sufficient: false,
        merged: false,
        userAccount: userAccount,
        totalBalance: totalBalance,
        reason: `Insufficient balance: have ${totalBalance}, need ${requiredAmount}`
      };
    } catch (error) {
      console.error('[UTXO Handler] Error checking balance:', error);
      return {
        sufficient: false,
        merged: false,
        userAccount: null,
        reason: error.message
      };
    }
  }

  /**
   * Handle UTXO merging before order placement
   * Called before placing an order to ensure UTXOs are merged
   * @param {string} partyId - Party ID
   * @param {string} tradingPair - Trading pair (e.g., 'BTC/USDT')
   * @param {string} orderType - 'BUY' or 'SELL'
   * @param {number} quantity - Order quantity
   * @param {number} price - Order price (for limit orders)
   * @returns {Promise<{success: boolean, merged: boolean, userAccount: object|null}>}
   */
  async handlePreOrderPlacement(partyId, tradingPair, orderType, quantity, price = null) {
    try {
      const [baseToken, quoteToken] = tradingPair.split('/');
      
      // Determine which token needs to be checked/merged
      // BUY orders: need quote token (e.g., USDT to buy BTC)
      // SELL orders: need base token (e.g., BTC to sell)
      const requiredToken = orderType === 'BUY' ? quoteToken : baseToken;
      const requiredAmount = orderType === 'BUY' 
        ? (price ? quantity * price : quantity) // For limit orders: quantity * price, for market: just quantity
        : quantity; // For sell orders: just quantity

      console.log(`[UTXO Handler] Pre-order placement check for ${partyId}`);
      console.log(`[UTXO Handler] Order type: ${orderType}, Token: ${requiredToken}, Amount: ${requiredAmount}`);

      const result = await this.checkAndMergeBalance(partyId, requiredToken, requiredAmount);

      if (!result.sufficient) {
        return {
          success: false,
          merged: result.merged,
          error: result.reason,
          userAccount: result.userAccount
        };
      }

      return {
        success: true,
        merged: result.merged,
        userAccount: result.userAccount,
        totalBalance: result.totalBalance
      };
    } catch (error) {
      console.error('[UTXO Handler] Error in pre-order placement:', error);
      return {
        success: false,
        merged: false,
        error: error.message
      };
    }
  }

  /**
   * Handle UTXO merging after order cancellation
   * Called after an order is cancelled to merge released UTXOs
   * @param {string} partyId - Party ID
   * @param {string} tradingPair - Trading pair
   * @param {string} orderType - 'BUY' or 'SELL'
   * @param {string} userAccountContractId - UserAccount contract ID
   * @returns {Promise<{success: boolean}>}
   */
  async handlePostCancellation(partyId, tradingPair, orderType, userAccountContractId) {
    try {
      console.log(`[UTXO Handler] Post-cancellation UTXO merge for ${partyId}`);
      
      // Use the existing auto-merge function
      await this.utxoMerger.autoMergeAfterCancellation(partyId, tradingPair, orderType, userAccountContractId);
      
      return {
        success: true
      };
    } catch (error) {
      console.warn('[UTXO Handler] Post-cancellation merge failed (non-critical):', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle UTXO merging after partial fill
   * Called after a partial order fill to merge remaining UTXOs
   * @param {string} partyId - Party ID
   * @param {string} tradingPair - Trading pair
   * @param {string} orderType - 'BUY' or 'SELL'
   * @param {number} remainingQuantity - Remaining order quantity
   * @param {string} userAccountContractId - UserAccount contract ID
   * @returns {Promise<{success: boolean}>}
   */
  async handlePostPartialFill(partyId, tradingPair, orderType, remainingQuantity, userAccountContractId) {
    try {
      console.log(`[UTXO Handler] Post-partial-fill UTXO merge for ${partyId}`);
      console.log(`[UTXO Handler] Remaining quantity: ${remainingQuantity}`);
      
      const [baseToken, quoteToken] = tradingPair.split('/');
      
      // Determine which token needs merging
      // BUY orders: quote token was partially used, merge remaining
      // SELL orders: base token was partially used, merge remaining
      const tokenToMerge = orderType === 'BUY' ? quoteToken : baseToken;
      
      // Merge UTXOs to consolidate remaining balance
      await this.utxoMerger.mergeUTXOs(partyId, tokenToMerge, userAccountContractId);
      
      console.log(`[UTXO Handler] ✅ Post-partial-fill merge completed for ${tokenToMerge}`);
      
      return {
        success: true
      };
    } catch (error) {
      console.warn('[UTXO Handler] Post-partial-fill merge failed (non-critical):', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = UTXOHandler;

