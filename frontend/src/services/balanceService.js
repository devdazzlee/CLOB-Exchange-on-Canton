/**
 * Balance Service - Unified interface for both legacy and new token standards
 * 
 * This service provides a unified API that can work with:
 * 1. Legacy UserAccount-based balances (text maps)
 * 2. New Holding-based token standard (real tokens)
 * 
 * Use the token standard when available for production.
 */

import { apiClient, API_ROUTES } from '../config/config';

// Feature flag - set to true to use new token standard
const USE_TOKEN_STANDARD = import.meta.env.VITE_USE_TOKEN_STANDARD === 'true' || false;

/**
 * Get user balances
 * @param {string} partyId - User's party ID
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function getBalances(partyId, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!partyId) {
    throw new Error('Party ID is required');
  }

  try {
    const route = useTokenStandard 
      ? API_ROUTES.BALANCE_V2.GET(partyId)
      : API_ROUTES.BALANCE.GET(partyId);
    
    const response = await apiClient.get(route);
    
    // Normalize response format
    return {
      available: response.data?.available || response.data?.balance || {},
      locked: response.data?.locked || {},
      total: response.data?.total || response.data?.balance || {},
      holdings: response.data?.holdings || [],
      tokenStandard: useTokenStandard,
      source: response.data?.source || (useTokenStandard ? 'holdings' : 'userAccount'),
    };
  } catch (error) {
    console.error('[BalanceService] Failed to get balances:', error.message);
    
    // Return empty balances on error
    return {
      available: {},
      locked: {},
      total: {},
      holdings: [],
      tokenStandard: useTokenStandard,
      error: error.message,
    };
  }
}

/**
 * Mint test tokens
 * @param {string} partyId - User's party ID
 * @param {Array} tokens - Array of { symbol, amount } objects
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function mintTokens(partyId, tokens, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!partyId) {
    throw new Error('Party ID is required');
  }

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Tokens array is required');
  }

  try {
    const route = useTokenStandard 
      ? API_ROUTES.BALANCE_V2.MINT
      : API_ROUTES.BALANCE.MINT;
    
    const response = await apiClient.post(route, {
      partyId,
      tokens,
    });
    
    return {
      success: true,
      data: response.data,
      tokenStandard: useTokenStandard,
    };
  } catch (error) {
    console.error('[BalanceService] Failed to mint tokens:', error.message);
    throw error;
  }
}

/**
 * Get detailed Holdings (token standard only)
 * @param {string} partyId - User's party ID
 * @param {string} symbol - Optional symbol filter
 */
export async function getHoldings(partyId, symbol = null) {
  if (!partyId) {
    throw new Error('Party ID is required');
  }

  try {
    const response = await apiClient.get(API_ROUTES.BALANCE_V2.HOLDINGS(partyId, symbol));
    return response.data || { holdings: [] };
  } catch (error) {
    console.error('[BalanceService] Failed to get holdings:', error.message);
    return { holdings: [] };
  }
}

/**
 * Lock a holding for an order (token standard only)
 */
export async function lockHolding(holdingCid, lockHolder, lockReason, lockAmount, ownerPartyId) {
  try {
    const response = await apiClient.post(API_ROUTES.BALANCE_V2.LOCK, {
      holdingCid,
      lockHolder,
      lockReason,
      lockAmount,
      ownerPartyId,
    });
    return response.data;
  } catch (error) {
    console.error('[BalanceService] Failed to lock holding:', error.message);
    throw error;
  }
}

/**
 * Unlock a holding (token standard only)
 */
export async function unlockHolding(holdingCid, ownerPartyId) {
  try {
    const response = await apiClient.post(API_ROUTES.BALANCE_V2.UNLOCK, {
      holdingCid,
      ownerPartyId,
    });
    return response.data;
  } catch (error) {
    console.error('[BalanceService] Failed to unlock holding:', error.message);
    throw error;
  }
}

/**
 * Format balance for display
 * @param {object} balances - Balance object with token amounts
 * @param {number} decimals - Number of decimal places
 */
export function formatBalances(balances, decimals = 8) {
  const formatted = {};
  for (const [symbol, amount] of Object.entries(balances || {})) {
    const numAmount = parseFloat(amount) || 0;
    formatted[symbol] = numAmount.toFixed(decimals);
  }
  return formatted;
}

/**
 * Check if token standard is enabled
 */
export function isTokenStandardEnabled() {
  return USE_TOKEN_STANDARD;
}

export default {
  getBalances,
  mintTokens,
  getHoldings,
  lockHolding,
  unlockHolding,
  formatBalances,
  isTokenStandardEnabled,
};
