/**
 * Keycloak OAuth 2.0 Authentication Service
 * Handles automatic token refresh and authentication flow
 */

const KEYCLOAK_BASE_URL = 'https://keycloak.wolfedgelabs.com:8443';
const REALM = 'canton-devnet';
const CLIENT_ID = 'Clob'; // Updated to new client ID from client

/**
 * Get Keycloak configuration
 */
function getKeycloakConfig() {
  return {
    url: KEYCLOAK_BASE_URL,
    realm: REALM,
    clientId: CLIENT_ID,
  };
}

/**
 * Get authorization endpoint URL
 */
function getAuthUrl() {
  const config = getKeycloakConfig();
  return `${config.url}/realms/${config.realm}/protocol/openid-connect/auth`;
}

/**
 * Get token endpoint URL
 */
function getTokenUrl() {
  const config = getKeycloakConfig();
  return `${config.url}/realms/${config.realm}/protocol/openid-connect/token`;
}

/**
 * Get refresh token endpoint URL
 */
function getRefreshTokenUrl() {
  return getTokenUrl(); // Same endpoint, different grant_type
}

/**
 * Generate PKCE code verifier and challenge
 */
async function generatePKCE() {
  const encoder = new TextEncoder();
  const data = new Uint8Array(32);
  crypto.getRandomValues(data);
  const verifier = btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const challenge = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return { verifier, challenge };
}

/**
 * Store tokens securely
 */
function storeTokens(accessToken, refreshToken, expiresIn) {
  const expiresAt = Date.now() + (expiresIn * 1000);
  
  localStorage.setItem('canton_access_token', accessToken);
  localStorage.setItem('canton_refresh_token', refreshToken);
  localStorage.setItem('canton_token_expires_at', expiresAt.toString());
  
  console.log('[Keycloak] Tokens stored. Expires in:', expiresIn, 'seconds');
}

/**
 * Get stored access token
 */
function getStoredAccessToken() {
  return localStorage.getItem('canton_access_token');
}

/**
 * Get stored refresh token
 */
function getStoredRefreshToken() {
  return localStorage.getItem('canton_refresh_token');
}

/**
 * Check if token is expired or will expire soon
 */
function isTokenExpired(bufferSeconds = 60) {
  const expiresAt = localStorage.getItem('canton_token_expires_at');
  if (!expiresAt) return true;
  
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  return parseInt(expiresAt) <= (now + bufferMs);
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const config = getKeycloakConfig();
  const tokenUrl = getRefreshTokenUrl();

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Keycloak] Refresh token failed:', error);
      // Clear tokens if refresh fails
      clearTokens();
      throw new Error('Token refresh failed. Please login again.');
    }

    const data = await response.json();
    storeTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in);
    
    console.log('[Keycloak] Token refreshed successfully');
    return data.access_token;
  } catch (error) {
    console.error('[Keycloak] Error refreshing token:', error);
    clearTokens();
    throw error;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken() {
  // Check if we have a token and if it's still valid
  if (!isTokenExpired()) {
    const token = getStoredAccessToken();
    if (token) {
      return token;
    }
  }

  // Token expired or missing, try to refresh
  console.log('[Keycloak] Token expired or missing, attempting refresh...');
  try {
    return await refreshAccessToken();
  } catch (error) {
    console.error('[Keycloak] Failed to refresh token:', error);
    // Redirect to login or show login modal
    throw new Error('Authentication required. Please login.');
  }
}

/**
 * Login using password grant flow (no redirect needed)
 * Professional flow - user enters credentials in app
 */
export async function loginWithPassword(username, password) {
  const config = getKeycloakConfig();
  const tokenUrl = getTokenUrl();

  try {
    // Try password grant - this might not work if client doesn't support it
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: config.clientId,
        username: username,
        password: password,
        scope: 'openid profile email',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Login failed';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error_description || errorData.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      
      // If password grant not supported, throw specific error
      if (response.status === 400) {
        throw new Error(`Password grant not supported for this client. ${errorMessage}`);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    storeTokens(data.access_token, data.refresh_token, data.expires_in);
    
    console.log('[Keycloak] Login successful');
    return data.access_token;
  } catch (error) {
    console.error('[Keycloak] Login error:', error);
    throw error;
  }
}

/**
 * Store token manually (fallback if password grant doesn't work)
 */
export function storeManualToken(token) {
  // Remove "Bearer " prefix if present
  const cleanToken = token.replace(/^Bearer\s+/i, '');
  
  // Parse token to get expiration
  try {
    const parts = cleanToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      const expiresIn = payload.exp ? (payload.exp * 1000 - Date.now()) / 1000 : 3600;
      storeTokens(cleanToken, null, expiresIn);
      return true;
    }
  } catch (e) {
    console.error('[Keycloak] Error parsing token:', e);
  }
  
  // Fallback: store with default expiration
  storeTokens(cleanToken, null, 3600);
  return true;
}

/**
 * Initiate OAuth login flow (requires redirect URI configuration)
 * Falls back to password grant if redirect URI not configured
 */
export async function initiateLogin() {
  // Try OAuth redirect flow first
  try {
    const config = getKeycloakConfig();
    const { verifier, challenge } = await generatePKCE();
    
    sessionStorage.setItem('pkce_verifier', verifier);
    
    // For local development, we need to handle the redirect URI issue
    // The client needs to add http://localhost:3000/auth/callback to Keycloak
    // Until then, we'll show a helpful error message
    if (import.meta.env.DEV) {
      throw new Error('DEV_REDIRECT_URI_NOT_CONFIGURED');
    }
    
    // Production redirect URI
    const redirectUri = 'https://clob-exchange-on-canton.vercel.app/auth/callback';
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email', // Use only standard OAuth scopes
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${getAuthUrl()}?${params.toString()}`;
    console.log('[Keycloak] Redirecting to:', authUrl);
    console.log('[Keycloak] Redirect URI:', redirectUri);
    window.location.href = authUrl;
  } catch (error) {
    console.error('[Keycloak] OAuth flow failed:', error);
    throw error;
  }
}

/**
 * Handle OAuth callback and exchange code for tokens
 */
export async function handleAuthCallback(code) {
  const config = getKeycloakConfig();
  const verifier = sessionStorage.getItem('pkce_verifier');
  
  if (!verifier) {
    throw new Error('PKCE verifier not found');
  }

  try {
    // Use different redirect URIs for development vs production
    const redirectUri = import.meta.env.DEV 
      ? 'http://localhost:3000/auth/callback'  // Local development
      : 'https://clob-exchange-on-canton.vercel.app/auth/callback'; // Production

    // In production, use proxy to avoid CORS issues
    const tokenUrl = import.meta.env.DEV
      ? getTokenUrl()  // Direct call in development
      : '/api/proxy/keycloak-token'; // Use proxy in production

    const tokenData = {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    };

    let response;
    
    if (import.meta.env.DEV) {
      // Direct call in development
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(tokenData),
      });
    } else {
      // Use proxy in production to avoid CORS
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokenUrl: getTokenUrl(),
          tokenData: tokenData
        }),
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error('[Keycloak] Token exchange failed:', error);
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    storeTokens(data.access_token, data.refresh_token, data.expires_in);
    
    // Clear PKCE verifier
    sessionStorage.removeItem('pkce_verifier');
    
    console.log('[Keycloak] Authentication successful');
    return data.access_token;
  } catch (error) {
    console.error('[Keycloak] Error exchanging code for tokens:', error);
    throw error;
  }
}

/**
 * Clear all stored tokens
 */
export function clearTokens() {
  localStorage.removeItem('canton_access_token');
  localStorage.removeItem('canton_refresh_token');
  localStorage.removeItem('canton_token_expires_at');
  console.log('[Keycloak] Tokens cleared');
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return !!getStoredAccessToken() && !isTokenExpired();
}

/**
 * Logout user
 */
export function logout() {
  clearTokens();
  // Optionally redirect to Keycloak logout
  window.location.href = '/';
}

