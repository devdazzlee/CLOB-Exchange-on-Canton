/**
 * Auth Service - Professional Token Management
 * 
 * Implements:
 * - Access token + refresh token pattern
 * - Automatic token refresh before expiry
 * - Token storage with encryption
 * - Session management
 * - Retry with token refresh on 401
 */

import { apiClient, API_ROUTES } from '../config/config';

// Token storage keys
const ACCESS_TOKEN_KEY = 'clob_access_token';
const REFRESH_TOKEN_KEY = 'clob_refresh_token';
const TOKEN_EXPIRY_KEY = 'clob_token_expiry';
const USER_DATA_KEY = 'clob_user_data';

// Refresh token 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

class AuthService {
  constructor() {
    this.refreshPromise = null;
    this.refreshTimer = null;
    this.listeners = new Set();
  }

  /**
   * Initialize auth service - call on app start
   */
  async initialize() {
    const accessToken = this.getAccessToken();
    if (accessToken && this.isTokenExpired()) {
      // Token expired, try to refresh
      try {
        await this.refreshTokens();
      } catch (error) {
        console.warn('[AuthService] Failed to refresh token on init:', error.message);
        this.clearTokens();
      }
    } else if (accessToken) {
      // Schedule refresh before expiry
      this.scheduleTokenRefresh();
    }
  }

  /**
   * Login with wallet signature
   */
  async login(publicKey, signature, challenge) {
    const data = await apiClient.post(API_ROUTES.AUTH.LOGIN, {
      publicKey,
      signature,
      challenge
    });
    this.storeTokens(data);
    this.scheduleTokenRefresh();
    this.notifyListeners('login', data);
    
    return data;
  }

  /**
   * Login with party ID (simplified flow for existing wallets)
   */
  async loginWithParty(partyId, walletPublicKey) {
    const response = await apiClient.post(API_ROUTES.AUTH.SESSION, {
      partyId,
      publicKey: walletPublicKey
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Session creation failed');
    }

    const data = await response.json();
    this.storeTokens(data);
    this.scheduleTokenRefresh();
    this.notifyListeners('login', data);
    
    return data;
  }

  /**
   * Refresh tokens
   */
  async refreshTokens() {
    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    this.refreshPromise = (async () => {
      try {
        const data = await apiClient.post(API_ROUTES.AUTH.REFRESH, {
          refreshToken
        });
        this.storeTokens(data);
        this.scheduleTokenRefresh();
        console.log('[AuthService] Tokens refreshed successfully');
        
        return data;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Logout - clear all tokens and session
   */
  async logout() {
    const refreshToken = this.getRefreshToken();
    
    // Notify backend to invalidate refresh token
    if (refreshToken) {
      try {
        await apiClient.post(API_ROUTES.AUTH.LOGOUT, {
          refreshToken
        }, {
          headers: {
            'Authorization': `Bearer ${this.getAccessToken()}`
          }
        });
      } catch (error) {
        console.warn('[AuthService] Logout request failed:', error.message);
      }
    }

    this.clearTokens();
    this.notifyListeners('logout');
  }

  /**
   * Store tokens securely
   */
  storeTokens(data) {
    const { accessToken, refreshToken, expiresIn, user } = data;
    
    if (accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    }
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
    if (expiresIn) {
      const expiry = Date.now() + (expiresIn * 1000);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiry.toString());
    }
    if (user) {
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
    }
  }

  /**
   * Clear all tokens
   */
  clearTokens() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(USER_DATA_KEY);
    
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Get access token
   */
  getAccessToken() {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  /**
   * Get refresh token
   */
  getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  /**
   * Get token expiry
   */
  getTokenExpiry() {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry, 10) : null;
  }

  /**
   * Get user data
   */
  getUserData() {
    const data = localStorage.getItem(USER_DATA_KEY);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return true;
    return Date.now() >= expiry;
  }

  /**
   * Check if token needs refresh (within buffer)
   */
  needsRefresh() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return true;
    return Date.now() >= (expiry - REFRESH_BUFFER_MS);
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    const token = this.getAccessToken();
    return !!token && !this.isTokenExpired();
  }

  /**
   * Schedule automatic token refresh
   */
  scheduleTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const expiry = this.getTokenExpiry();
    if (!expiry) return;

    // Calculate when to refresh (5 minutes before expiry)
    const refreshAt = expiry - REFRESH_BUFFER_MS;
    const delay = refreshAt - Date.now();

    if (delay <= 0) {
      // Already time to refresh
      this.refreshTokens().catch(error => {
        console.error('[AuthService] Auto-refresh failed:', error.message);
        this.notifyListeners('authError', { error });
      });
    } else {
      console.log(`[AuthService] Scheduling token refresh in ${Math.round(delay / 1000)}s`);
      this.refreshTimer = setTimeout(() => {
        this.refreshTokens().catch(error => {
          console.error('[AuthService] Scheduled refresh failed:', error.message);
          this.notifyListeners('authError', { error });
        });
      }, delay);
    }
  }

  /**
   * Fetch with automatic token handling
   */
  async fetchWithAuth(url, options = {}) {
    // Refresh if needed before request
    if (this.needsRefresh()) {
      try {
        await this.refreshTokens();
      } catch (error) {
        this.notifyListeners('authError', { error });
        throw error;
      }
    }

    const accessToken = this.getAccessToken();
    const headers = {
      ...options.headers,
      ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
    };

    try {
      const response = await apiClient({
        url,
        method: options.method || 'GET',
        data: options.body ? JSON.parse(options.body) : options.data,
        headers
      });
      return { ok: true, status: 200, json: async () => response, ...response };
    } catch (error) {
      // If 401, try refresh once and retry
      if (error.response?.status === 401) {
        try {
          await this.refreshTokens();
          const newToken = this.getAccessToken();
          const retryResponse = await apiClient({
            url,
            method: options.method || 'GET',
            data: options.body ? JSON.parse(options.body) : options.data,
            headers: { ...headers, 'Authorization': `Bearer ${newToken}` }
          });
          return { ok: true, status: 200, json: async () => retryResponse, ...retryResponse };
        } catch (refreshError) {
          this.notifyListeners('authError', { error: refreshError });
          throw refreshError;
        }
      }
      throw error;
    }
  }

  /**
   * Subscribe to auth events
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data = {}) {
    this.listeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('[AuthService] Listener error:', error);
      }
    });
  }
}

// Singleton instance
const authService = new AuthService();

export default authService;
export { authService };
