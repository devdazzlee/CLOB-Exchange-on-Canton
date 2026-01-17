/**
 * Authentication and Operator Configuration for CLOB Exchange
 * 
 * This file contains:
 * - Keycloak OAuth settings
 * - Canton ledger configuration
 * - Operator (Venue) party ID for the global order book
 */

// =============================================================================
// OPERATOR CONFIGURATION - The Venue Owner
// =============================================================================

/**
 * The Operator Party ID (Venue Owner)
 * This party owns all MasterOrderBook contracts on the exchange.
 * Users read from this global order book - they do NOT create their own.
 * 
 * IMPORTANT: This must match the party ID used in deploymentScript.js
 */
export const OPERATOR_PARTY_ID = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

/**
 * Public observer party ID (for reading global order books)
 * This is a generic party that all users can "readAs" to see the global order book
 */
export const PUBLIC_OBSERVER_PARTY_ID = 'public-observer';

// =============================================================================
// KEYCLOAK OAUTH CONFIGURATION
// =============================================================================

/**
 * Keycloak OAuth 2.0 Configuration
 * Used for authenticating users with Canton's Keycloak instance
 */
export const KEYCLOAK_CONFIG = {
  url: 'https://keycloak.wolfedgelabs.com:8443',
  realm: 'canton-devnet',
  clientId: 'snp3u6udkFF983rfprvsBbx3X3mBpw',
  clientSecret: 'l5Td3OUSanQoGeNMWg2nnPxq1VYc'
};

/**
 * Get the Keycloak authorization URL
 */
export function getAuthorizationUrl() {
  return `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/auth`;
}

/**
 * Get the Keycloak token URL
 */
export function getTokenUrl() {
  return `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/token`;
}

/**
 * Get the Keycloak logout URL
 */
export function getLogoutUrl() {
  return `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/logout`;
}

// =============================================================================
// CANTON LEDGER CONFIGURATION
// =============================================================================

/**
 * Canton Ledger API Configuration
 */
export const CANTON_CONFIG = {
  jsonApiBase: 'https://participant.dev.canton.wolfedgelabs.com/json-api',
  participantBase: 'https://participant.dev.canton.wolfedgelabs.com',
  version: 'v2'
};

// =============================================================================
// JWT TOKEN UTILITIES
// =============================================================================

/**
 * Decode a JWT token and extract the payload
 * @param {string} token - JWT token string
 * @returns {object|null} Decoded payload or null if invalid
 */
export function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (error) {
    console.error('[AuthConfig] Error decoding JWT:', error);
    return null;
  }
}

/**
 * Extract ledger ID from JWT token
 * @param {string} token - JWT token string
 * @returns {string|null} Ledger ID or null
 */
export function getLedgerIdFromToken(token) {
  const payload = decodeJWT(token);
  if (!payload) return null;
  
  // Ledger ID might be in the audience or as a custom claim
  if (typeof payload.aud === 'string') {
    return payload.aud;
  }
  return null;
}

/**
 * Extract party ID from JWT token
 * NOTE: The full Canton party ID (prefix::suffix) is typically NOT in the token.
 * The token's 'sub' field only contains the prefix.
 * Use the stored canton_party_id from localStorage for the full ID.
 * 
 * @param {string} token - JWT token string
 * @returns {string|null} Party ID prefix from token
 */
export function getPartyIdFromToken(token) {
  // First, check localStorage for the full Canton party ID
  const storedPartyId = localStorage.getItem('canton_party_id');
  if (storedPartyId) {
    return storedPartyId;
  }
  
  // Fallback: extract from token (but this is only the prefix)
  const payload = decodeJWT(token);
  if (!payload) return null;
  
  // Party might be in custom claim or derived from subject
  if (payload.party) {
    return payload.party;
  }
  
  // The 'sub' field contains the user ID prefix
  console.warn('[AuthConfig] No full party ID available. Token sub:', payload.sub);
  return null;
}

/**
 * Check if a token is expired
 * @param {string} token - JWT token string
 * @param {number} bufferSeconds - Seconds before expiry to consider expired (default: 60)
 * @returns {boolean} true if expired or will expire within buffer
 */
export function isTokenExpired(token, bufferSeconds = 60) {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) {
    return true;
  }
  
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= (now + bufferSeconds);
}

/**
 * Check if token has the required Canton scope
 * @param {string} token - JWT token string
 * @returns {boolean} true if token has daml_ledger_api scope
 */
export function hasCantonScope(token) {
  const payload = decodeJWT(token);
  if (!payload || !payload.scope) {
    return false;
  }
  
  return payload.scope.includes('daml_ledger_api');
}

// =============================================================================
// STORAGE KEYS
// =============================================================================

export const STORAGE_KEYS = {
  JWT_TOKEN: 'canton_jwt_token',
  JWT_EXPIRES_AT: 'canton_jwt_token_expires_at',
  REFRESH_TOKEN: 'canton_jwt_refresh_token',
  PARTY_ID: 'canton_party_id',
  PKCE_VERIFIER: 'pkce_verifier'
};

// =============================================================================
// REDIRECT URIS
// =============================================================================

/**
 * Get the OAuth redirect URI based on environment
 */
export function getRedirectUri() {
  if (typeof window !== 'undefined') {
    // Check if we're in development
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1';
    
    if (isDev) {
      return 'http://localhost:3000/auth/callback';
    }
  }
  
  // Production redirect URI
  return 'https://clob-exchange-on-canton.vercel.app/auth/callback';
}

// =============================================================================
// API HELPERS
// =============================================================================

/**
 * Get headers for authenticated Canton API calls
 * @param {string} token - JWT access token
 * @returns {object} Headers object with Authorization
 */
export function getAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Build the Canton JSON API URL for a given endpoint
 * @param {string} endpoint - API endpoint (e.g., '/state/active-contracts')
 * @returns {string} Full URL
 */
export function getCantonApiUrl(endpoint) {
  const base = CANTON_CONFIG.jsonApiBase;
  const version = CANTON_CONFIG.version;
  
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  return `${base}/${version}${normalizedEndpoint}`;
}

// =============================================================================
// GLOBAL ORDER BOOK HELPERS
// =============================================================================

/**
 * Get the default trading pairs supported by the exchange
 */
export function getDefaultTradingPairs() {
  return ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
}

/**
 * Format trading pair for display (e.g., "BTC-USDT" -> "BTC/USDT")
 */
export function formatTradingPair(pair) {
  return pair.replace('-', '/');
}

/**
 * Normalize trading pair (e.g., "BTC/USDT" -> "BTC-USDT")
 */
export function normalizeTradingPair(pair) {
  return pair.replace('/', '-');
}

// =============================================================================
// EXPORTED DEFAULT CONFIG
// =============================================================================

export default {
  operator: {
    partyId: OPERATOR_PARTY_ID,
    publicObserver: PUBLIC_OBSERVER_PARTY_ID
  },
  keycloak: KEYCLOAK_CONFIG,
  canton: CANTON_CONFIG,
  storage: STORAGE_KEYS,
  getRedirectUri,
  getAuthorizationUrl,
  getTokenUrl,
  getLogoutUrl,
  getCantonApiUrl,
  getAuthHeaders
};
