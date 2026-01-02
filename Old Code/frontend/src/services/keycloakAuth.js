/**
 * Keycloak OAuth 2.0 Authentication Service
 * Handles automatic token refresh and authentication flow
 */

const KEYCLOAK_BASE_URL = 'https://keycloak.wolfedgelabs.com:8443';
const REALM = 'canton-devnet';
const CLIENT_ID = '4roh9X7y4TyT89feJu7AnM2sMZbR9xh7'; // From JWT token

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
 * Initiate OAuth login flow
 */
export async function initiateLogin() {
  const config = getKeycloakConfig();
  const { verifier, challenge } = await generatePKCE();
  
  // Store verifier for later verification
  sessionStorage.setItem('pkce_verifier', verifier);
  
  // Redirect URI - must match Keycloak client configuration
  // Common patterns that might be configured:
  // 1. Exact: http://localhost:3000/auth/callback
  // 2. Wildcard path: http://localhost:3000/*
  // 3. Wildcard port: http://localhost:*/auth/callback
  // 4. All localhost: http://localhost:*/*
  
  // Keycloak requires EXACT match - no wildcards!
  // Must add this exact URI to Keycloak client configuration
  const redirectUri = window.location.origin + '/auth/callback';
  
  console.log('[Keycloak] Using redirect URI:', redirectUri);
  console.log('[Keycloak] ⚠️  MUST ADD TO KEYCLOAK:');
  console.log('[Keycloak]    1. https://keycloak.wolfedgelabs.com:8443');
  console.log('[Keycloak]    2. Clients → 4roh9X7y4TyT89feJu7AnM2sMZbR9xh7');
  console.log('[Keycloak]    3. Settings → Valid redirect URIs');
  console.log('[Keycloak]    4. Add:', redirectUri);
  console.log('[Keycloak]    5. Save');
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email daml_ledger_api wallet_audience',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${getAuthUrl()}?${params.toString()}`;
  window.location.href = authUrl;
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

  const tokenUrl = getTokenUrl();

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: window.location.origin + '/auth/callback',
        client_id: config.clientId,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
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

