/**
 * API Service - Authenticated Requests
 * 
 * Handles authenticated requests to the exchange API using wallet session tokens.
 */

import { getAuthHeader, getStoredSessionToken } from './walletService';
import { apiClient, API_ROUTES } from '../config/config';

/**
 * Make authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const authHeader = getAuthHeader();
  const { walletId } = getStoredSessionToken();

  if (!authHeader) {
    throw new Error('No active session. Please unlock your wallet first.');
  }

  try {
    return await apiClient({
      url: endpoint,
      method: options.method || 'GET',
      data: options.body ? JSON.parse(options.body) : options.data,
      headers: {
        'Authorization': authHeader,
        ...options.headers,
      },
    });
  } catch (error) {
    // Handle session expiration
    if (error.response?.status === 401) {
      localStorage.removeItem('canton_wallet_id');
      localStorage.removeItem('canton_session_token');
      window.location.href = '/wallet';
      throw new Error('Session expired. Please unlock your wallet again.');
    }
    throw error;
  }
}

/**
 * Place an order
 */
export async function placeOrder(orderData) {
  // Map frontend order data format to backend API format
  const backendOrderData = {
    pair: orderData.tradingPair,
    side: orderData.orderType, // BUY or SELL
    type: orderData.orderMode, // LIMIT or MARKET
    price: orderData.price || null,
    quantity: orderData.quantity,
    timeInForce: orderData.timeInForce || 'GTC',
    stopLossPrice: orderData.stopLoss || orderData.stopLossPrice || null, // Support both field names
    clientOrderId: orderData.clientOrderId || null
  };

  return apiRequest('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(backendOrderData),
  });
}

/**
 * Get user's orders
 */
export async function getOrders(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest(`/v1/orders${queryString ? `?${queryString}` : ''}`);
}

/**
 * Cancel an order
 */
export async function cancelOrder(contractId, reason = 'user_requested') {
  return apiRequest(`/v1/orders/${contractId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Get orderbook
 */
export async function getOrderbook(pair) {
  return await apiClient.get(API_ROUTES.ORDERBOOK.GET(pair));
}

/**
 * Get recent trades
 */
export async function getTrades(params = {}) {
  return await apiClient.get(API_ROUTES.TRADES.GET_ALL(params));
}

/**
 * Get tickers
 */
export async function getTickers() {
  return await apiClient.get(API_ROUTES.TICKERS);
}

/**
 * Get balances
 */
export async function getBalances(partyId) {
  return apiRequest(`/v1/balances/${encodeURIComponent(partyId)}`);
}

/**
 * Get wallet info
 */
export async function getWalletInfo(walletId) {
  try {
    return await apiClient.get(API_ROUTES.WALLET.INFO(walletId));
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
