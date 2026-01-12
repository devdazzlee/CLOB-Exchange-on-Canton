/**
 * UTXO Merger Service
 * Handles UTXO consolidation for Canton's UTXO model
 * 
 * When orders are cancelled, UTXOs may remain separate.
 * This service merges UTXOs to allow larger orders after cancellation.
 * 
 * Reference: https://docs.digitalasset.com/integrate/devnet/party-management/index.html
 */

const CantonAdminService = require('./canton-admin');

class UTXOMerger {
  constructor() {
    this.cantonAdmin = new CantonAdminService();
  }

  /**
   * Merge UTXOs for a user account
   * This consolidates separate UTXO balances into a single UTXO
   * 
   * @param {string} partyId - Party ID of the user
   * @param {string} token - Token symbol (e.g., 'BTC', 'USDT')
   * @param {string} userAccountContractId - UserAccount contract ID
   * @returns {Promise<object>} Result of merge operation
   */
  async mergeUTXOs(partyId, token, userAccountContractId) {
    try {
      const adminToken = await this.cantonAdmin.getAdminToken();
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';

      // Exercise MergeBalances choice on UserAccount
      // This recreates the contract, which may trigger UTXO consolidation at ledger level
      const commandId = `merge-utxos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const response = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          commandId: commandId,
          commands: [
            {
              exercise: {
                templateId: 'UserAccount:UserAccount',
                contractId: userAccountContractId,
                choice: 'MergeBalances',
                argument: {}
              }
            }
          ],
          actAs: [partyId]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: errorText };
        }
        throw new Error(error.message || error.cause || `Failed to merge UTXOs: ${response.statusText}`);
      }

      const result = await response.json();
      
      console.log(`[UTXO Merger] Merged UTXOs for ${partyId}, token: ${token}`);
      
      return {
        success: true,
        partyId,
        token,
        result
      };
    } catch (error) {
      console.error('[UTXO Merger] Error:', error);
      throw error;
    }
  }

  /**
   * Auto-merge UTXOs after order cancellation
   * Called automatically when an order is cancelled to prevent UTXO fragmentation
   * 
   * @param {string} partyId - Party ID
   * @param {string} tradingPair - Trading pair (e.g., 'BTC/USDT')
   * @param {string} orderType - 'BUY' or 'SELL'
   * @param {string} userAccountContractId - UserAccount contract ID
   */
  async autoMergeAfterCancellation(partyId, tradingPair, orderType, userAccountContractId) {
    try {
      const [baseToken, quoteToken] = tradingPair.split('/');
      
      // Determine which token needs UTXO merging
      // For BUY orders: quote token was locked, needs merging
      // For SELL orders: base token was locked, needs merging
      const tokenToMerge = orderType === 'BUY' ? quoteToken : baseToken;
      
      console.log(`[UTXO Merger] Auto-merging UTXOs for ${partyId} after ${orderType} order cancellation`);
      console.log(`[UTXO Merger] Token to merge: ${tokenToMerge}`);
      
      await this.mergeUTXOs(partyId, tokenToMerge, userAccountContractId);
      
      console.log(`[UTXO Merger] ✅ Auto-merge completed for ${tokenToMerge}`);
    } catch (error) {
      // Log but don't throw - UTXO merging is best-effort
      // Orders can still be placed even if merge fails (may just need manual merge)
      console.warn('[UTXO Merger] Auto-merge failed (non-critical):', error.message);
    }
  }
}

module.exports = UTXOMerger;

