/**
 * Enterprise-Grade API Client
 * 
 * Features:
 * - Automatic token injection from Keycloak OAuth
 * - Automatic token refresh before expiration
 * - Automatic retry on 401 with token refresh
 * - Centralized error handling
 * - Request/response interceptors
 * 
 * This is the single source of truth for all API calls to Canton.
 */

import { getValidAccessToken } from './keycloakAuth';

// Base URL configuration
const CANTON_API_BASE = import.meta.env.DEV 
  ? '/api/canton'  // Use Vite proxy in development
  : 'https://clob-exchange-on-canton.vercel.app/api/proxy';  // Use Vercel proxy in production

const API_VERSION = 'v2';

/**
 * Global flag to prevent concurrent token refresh requests
 */
let isRefreshing = false;
let refreshPromise = null;

/**
 * Get valid access token with automatic refresh
 * Prevents concurrent refresh requests
 */
async function getTokenWithRefresh() {
  // If already refreshing, wait for that promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  try {
    return await getValidAccessToken();
  } catch (error) {
    // If refresh fails, start a new refresh attempt
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = getValidAccessToken()
        .finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      return refreshPromise;
    }
    throw error;
  }
}

/**
 * Make authenticated API request with automatic retry on 401
 * 
 * @param {string} endpoint - API endpoint (e.g., '/v2/packages')
 * @param {RequestInit} options - Fetch options
 * @param {number} retryCount - Internal retry counter
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(endpoint, options = {}, retryCount = 0) {
  const maxRetries = 1; // Only retry once after token refresh
  
  try {
    // Get valid token (will refresh if needed)
    const token = await getTokenWithRefresh();
    
    if (!token) {
      throw new Error('No valid access token available. Please authenticate.');
    }

    // Build full URL
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${CANTON_API_BASE}/${API_VERSION}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    };

    // Make request
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized - token might be expired, try refresh and retry
    if (response.status === 401 && retryCount < maxRetries) {
      console.warn('[API Client] Received 401, attempting token refresh and retry...');
      
      // Force token refresh by clearing the refresh flag
      isRefreshing = false;
      refreshPromise = null;
      
      // Wait a bit to ensure token refresh completes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Retry the request with fresh token
      return authenticatedFetch(endpoint, options, retryCount + 1);
    }

    return response;
  } catch (error) {
    // If it's an auth error and we haven't retried, try once more
    if (error.message.includes('Authentication required') && retryCount < maxRetries) {
      console.warn('[API Client] Auth error, attempting token refresh and retry...');
      isRefreshing = false;
      refreshPromise = null;
      await new Promise(resolve => setTimeout(resolve, 100));
      return authenticatedFetch(endpoint, options, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * API Client with standard methods
 */
export const apiClient = {
  /**
   * GET request
   */
  async get(endpoint, options = {}) {
    const response = await authenticatedFetch(endpoint, {
      ...options,
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `GET ${endpoint} failed with status ${response.status}`);
    }

    return response.json();
  },

  /**
   * POST request
   */
  async post(endpoint, data = null, options = {}) {
    const response = await authenticatedFetch(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `POST ${endpoint} failed with status ${response.status}`);
    }

    return response.json();
  },

  /**
   * PUT request
   */
  async put(endpoint, data = null, options = {}) {
    const response = await authenticatedFetch(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `PUT ${endpoint} failed with status ${response.status}`);
    }

    return response.json();
  },

  /**
   * DELETE request
   */
  async delete(endpoint, options = {}) {
    const response = await authenticatedFetch(endpoint, {
      ...options,
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `DELETE ${endpoint} failed with status ${response.status}`);
    }

    // DELETE might not return JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  },

  /**
   * Raw fetch for custom requests
   */
  async fetch(endpoint, options = {}) {
    return authenticatedFetch(endpoint, options);
  },
};

export default apiClient;

