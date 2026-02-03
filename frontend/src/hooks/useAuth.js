/**
 * useAuth Hook - React integration for AuthService
 * 
 * Provides:
 * - Authentication state
 * - Login/logout functions
 * - Auto token refresh
 * - Loading states
 */

import { useState, useEffect, useCallback } from 'react';
import authService from '../services/authService';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      try {
        await authService.initialize();
        setIsAuthenticated(authService.isAuthenticated());
        setUser(authService.getUserData());
      } catch (err) {
        console.error('[useAuth] Init failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth events
    const unsubscribe = authService.subscribe((event, data) => {
      switch (event) {
        case 'login':
          setIsAuthenticated(true);
          setUser(data.user);
          setError(null);
          break;
        case 'logout':
          setIsAuthenticated(false);
          setUser(null);
          break;
        case 'authError':
          setError(data.error?.message || 'Authentication error');
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Login with party ID
  const login = useCallback(async (partyId, publicKey) => {
    setLoading(true);
    setError(null);
    try {
      const result = await authService.loginWithParty(partyId, publicKey);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await authService.logout();
    } catch (err) {
      console.error('[useAuth] Logout error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh tokens manually
  const refreshTokens = useCallback(async () => {
    setLoading(true);
    try {
      await authService.refreshTokens();
      setIsAuthenticated(authService.isAuthenticated());
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get access token
  const getAccessToken = useCallback(() => {
    return authService.getAccessToken();
  }, []);

  // Fetch with auth
  const fetchWithAuth = useCallback(async (url, options) => {
    return authService.fetchWithAuth(url, options);
  }, []);

  return {
    isAuthenticated,
    user,
    loading,
    error,
    login,
    logout,
    refreshTokens,
    getAccessToken,
    fetchWithAuth
  };
}

export default useAuth;
