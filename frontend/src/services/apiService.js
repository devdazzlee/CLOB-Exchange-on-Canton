/**
 * API Service - Authenticated Requests
 * 
 * Handles authenticated requests to the exchange API using wallet session tokens.
 */

import { getAuthHeader, getStoredSessionToken } from './walletService';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

/**
 * Make authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const authHeader = getAuthHeader();
  const { walletId } = getStoredSessionToken();

  if (!authHeader) {
    throw new Error('No active session. Please unlock your wallet first.');
  }

  const url = `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    
    // Handle session expiration
    if (response.status === 401) {
      localStorage.removeItem('canton_wallet_id');
      localStorage.removeItem('canton_session_token');
      window.location.href = '/wallet';
      throw new Error('Session expired. Please unlock your wallet again.');
    }
    
    throw new Error(errorData.error?.message || errorData.error || `API request failed: ${response.statusText}`);
  }

  return response.json();
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
  const response = await fetch(`${API_BASE_URL}/v1/orderbook/${encodeURIComponent(pair)}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get orderbook: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get recent trades
 */
export async function getTrades(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE_URL}/v1/trades${queryString ? `?${queryString}` : ''}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get trades: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get tickers
 */
export async function getTickers() {
  const response = await fetch(`${API_BASE_URL}/v1/tickers`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get tickers: ${response.statusText}`);
  }

  return response.json();
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
  const authHeader = getAuthHeader();
  
  const response = await fetch(`${API_BASE_URL}/v1/wallets/${encodeURIComponent(walletId)}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to get wallet info: ${response.statusText}`);
  }

  return response.json();
}
