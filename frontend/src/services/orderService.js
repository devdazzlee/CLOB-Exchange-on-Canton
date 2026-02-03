/**
 * Order Service - Unified interface for both legacy and new token standards
 * 
 * This service provides a unified API that can work with:
 * 1. Legacy Order contracts (text balances)
 * 2. New OrderV3 contracts (Holdings + DvP)
 * 
 * Use the token standard when available for production.
 */

import { apiClient, API_ROUTES } from '../config/config';

// Feature flag - Orders still use legacy API (V2 order creation has DAML encoding issues)
// Balances use V2 (Holdings) - that's handled in balanceService.js
const USE_TOKEN_STANDARD = import.meta.env.VITE_USE_TOKEN_STANDARD === 'true' || false; // Legacy for orders

/**
 * Place an order
 * @param {object} orderData - Order details
 * @param {string} orderData.partyId - User's party ID
 * @param {string} orderData.tradingPair - Trading pair (e.g., "BTC/USDT")
 * @param {string} orderData.side - "BUY" or "SELL"
 * @param {string} orderData.type - "LIMIT" or "MARKET"
 * @param {number} orderData.price - Price (null for market orders)
 * @param {number} orderData.quantity - Order quantity
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function placeOrder(orderData, useTokenStandard = USE_TOKEN_STANDARD) {
  const { partyId, tradingPair, side, type, price, quantity } = orderData;

  if (!partyId) {
    throw new Error('Party ID is required');
  }

  if (!tradingPair || !side || !quantity) {
    throw new Error('Trading pair, side, and quantity are required');
  }

  try {
    if (useTokenStandard) {
      // Use Token Standard V2 API (Holdings + OrderV3)
      const response = await apiClient.post(API_ROUTES.ORDERS_V2.PLACE, {
        partyId,
        tradingPair,
        side: side.toUpperCase(),
        type: type?.toUpperCase() || 'LIMIT',
        price: price || null,
        quantity: parseFloat(quantity),
      });

      return {
        success: true,
        order: response.data?.order || response.data,
        tokenStandard: true,
      };
    } else {
      // Use Legacy API
      const response = await apiClient.post(API_ROUTES.ORDERS.PLACE, {
        partyId,
        pair: tradingPair,
        side: side.toUpperCase(),
        type: type?.toUpperCase() || 'LIMIT',
        price,
        quantity: parseFloat(quantity),
      });

      return {
        success: true,
        order: response.data?.order || response.data,
        tokenStandard: false,
      };
    }
  } catch (error) {
    console.error('[OrderService] Failed to place order:', error.message);
    throw error;
  }
}

/**
 * Get user orders
 * @param {string} partyId - User's party ID
 * @param {string} status - Optional status filter
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function getOrders(partyId, status = null, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!partyId) {
    throw new Error('Party ID is required');
  }

  try {
    const route = useTokenStandard 
      ? API_ROUTES.ORDERS_V2.GET(partyId, status)
      : API_ROUTES.ORDERS.GET_USER(partyId, status);

    const response = await apiClient.get(route);

    return {
      orders: response.data?.orders || response.data || [],
      tokenStandard: useTokenStandard,
    };
  } catch (error) {
    console.error('[OrderService] Failed to get orders:', error.message);
    return { orders: [], tokenStandard: useTokenStandard, error: error.message };
  }
}

/**
 * Cancel an order
 * @param {string} contractId - Order contract ID
 * @param {string} partyId - User's party ID
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function cancelOrder(contractId, partyId, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!contractId) {
    throw new Error('Contract ID is required');
  }

  try {
    if (useTokenStandard) {
      const response = await apiClient.delete(
        API_ROUTES.ORDERS_V2.CANCEL(contractId, partyId)
      );
      return {
        success: true,
        data: response.data,
        tokenStandard: true,
      };
    } else {
      const response = await apiClient.post(API_ROUTES.ORDERS.CANCEL(contractId));
      return {
        success: true,
        data: response.data,
        tokenStandard: false,
      };
    }
  } catch (error) {
    console.error('[OrderService] Failed to cancel order:', error.message);
    throw error;
  }
}

/**
 * Get orderbook for a trading pair
 * @param {string} tradingPair - Trading pair (e.g., "BTC/USDT")
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function getOrderbook(tradingPair, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!tradingPair) {
    throw new Error('Trading pair is required');
  }

  try {
    const route = useTokenStandard 
      ? API_ROUTES.ORDERS_V2.ORDERBOOK(tradingPair)
      : API_ROUTES.ORDERBOOK.GET(tradingPair);

    const response = await apiClient.get(route);

    return {
      bids: response.data?.bids || [],
      asks: response.data?.asks || [],
      spread: response.data?.spread,
      lastPrice: response.data?.lastPrice,
      tradingPair,
      tokenStandard: useTokenStandard,
    };
  } catch (error) {
    console.error('[OrderService] Failed to get orderbook:', error.message);
    return {
      bids: [],
      asks: [],
      spread: null,
      lastPrice: null,
      tradingPair,
      tokenStandard: useTokenStandard,
      error: error.message,
    };
  }
}

/**
 * Get trades
 * @param {string} tradingPair - Optional trading pair filter
 * @param {number} limit - Max trades to return
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function getTrades(tradingPair = null, limit = 50, useTokenStandard = USE_TOKEN_STANDARD) {
  try {
    const route = useTokenStandard 
      ? API_ROUTES.TRADES_V2.GET(tradingPair, limit)
      : (tradingPair ? API_ROUTES.TRADES.GET(tradingPair, limit) : API_ROUTES.TRADES.GET_ALL({ limit }));

    const response = await apiClient.get(route);

    return {
      trades: response.data?.trades || response.data || [],
      tokenStandard: useTokenStandard,
    };
  } catch (error) {
    console.error('[OrderService] Failed to get trades:', error.message);
    return { trades: [], tokenStandard: useTokenStandard, error: error.message };
  }
}

/**
 * Get user trades
 * @param {string} partyId - User's party ID
 * @param {number} limit - Max trades to return
 * @param {boolean} useTokenStandard - Override to use new token standard
 */
export async function getUserTrades(partyId, limit = 50, useTokenStandard = USE_TOKEN_STANDARD) {
  if (!partyId) {
    throw new Error('Party ID is required');
  }

  try {
    const route = useTokenStandard 
      ? API_ROUTES.TRADES_V2.GET_USER(partyId, limit)
      : API_ROUTES.TRADES.GET_USER(partyId, limit);

    const response = await apiClient.get(route);

    return {
      trades: response.data?.trades || response.data || [],
      tokenStandard: useTokenStandard,
    };
  } catch (error) {
    console.error('[OrderService] Failed to get user trades:', error.message);
    return { trades: [], tokenStandard: useTokenStandard, error: error.message };
  }
}

/**
 * Check if token standard is enabled
 */
export function isTokenStandardEnabled() {
  return USE_TOKEN_STANDARD;
}

export default {
  placeOrder,
  getOrders,
  cancelOrder,
  getOrderbook,
  getTrades,
  getUserTrades,
  isTokenStandardEnabled,
};
