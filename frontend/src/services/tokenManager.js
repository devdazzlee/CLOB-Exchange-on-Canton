/**
 * Token Management Service
 * Handles JWT token storage, expiration detection, and refresh
 */

/**
 * Parse JWT token to get expiration time
 * @param {string} token - JWT token
 * @returns {number|null} Expiration timestamp in milliseconds, or null if invalid
 */
export function getTokenExpiration(token) {
  if (!token) return null;
  
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
  } catch (error) {
    console.error('[TokenManager] Error parsing token:', error);
    return null;
  }
}

/**
 * Check if token is expired or will expire soon
 * @param {string} token - JWT token
 * @param {number} bufferSeconds - Buffer time in seconds before expiration (default: 60)
 * @returns {boolean} True if token is expired or will expire soon
 */
export function isTokenExpired(token, bufferSeconds = 60) {
  const expiration = getTokenExpiration(token);
  console.log('[TokenManager] Token expiration:', expiration ? new Date(expiration).toISOString() : 'Invalid');
  if (!expiration) return true;
  
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  const isExpired = expiration <= (now + bufferMs);
  console.log('[TokenManager] Current time:', new Date(now).toISOString());
  console.log('[TokenManager] Buffer time:', bufferSeconds, 'seconds');
  console.log('[TokenManager] Is expired:', isExpired);
  return isExpired;
}

/**
 * Get token expiration time as human-readable string
 * @param {string} token - JWT token
 * @returns {string} Expiration time string
 */
export function getTokenExpirationString(token) {
  const expiration = getTokenExpiration(token);
  if (!expiration) return 'Unknown';
  
  const date = new Date(expiration);
  const now = Date.now();
  const minutesLeft = Math.floor((expiration - now) / 60000);
  
  if (minutesLeft < 0) return 'Expired';
  if (minutesLeft < 60) return `${minutesLeft} minutes`;
  
  const hoursLeft = Math.floor(minutesLeft / 60);
  return `${hoursLeft} hours`;
}

/**
 * Store token in localStorage with expiration info
 * @param {string} token - JWT token
 */
export function storeToken(token) {
  if (!token) return;
  
  // Remove "Bearer " prefix if present
  const cleanToken = token.replace(/^Bearer\s+/i, '');
  
  localStorage.setItem('canton_jwt_token', cleanToken);
  localStorage.setItem('canton_jwt_token_expires', getTokenExpiration(cleanToken)?.toString() || '');
  
  console.log('[TokenManager] Token stored. Expires in:', getTokenExpirationString(cleanToken));
}

/**
 * Get token from localStorage
 * @returns {string|null} Token or null if not found/expired
 */
export function getStoredToken() {
  const token = localStorage.getItem('canton_jwt_token');
  console.log('[TokenManager] Getting stored token:', token ? 'Found' : 'Not found');
  if (!token) return null;
  
  // Check if expired
  const expired = isTokenExpired(token);
  console.log('[TokenManager] Token expired check:', expired);
  if (expired) {
    console.warn('[TokenManager] Stored token is expired');
    return null;
  }
  
  console.log('[TokenManager] Returning valid token');
  return token;
}

/**
 * Clear stored token
 */
export function clearStoredToken() {
  localStorage.removeItem('canton_jwt_token');
  localStorage.removeItem('canton_jwt_token_expires');
}

/**
 * Check token and show warning if expiring soon
 * @param {string} token - JWT token
 * @returns {boolean} True if token is valid and not expiring soon
 */
export function checkTokenStatus(token) {
  if (!token) {
    console.warn('[TokenManager] No token available');
    return false;
  }
  
  const expiration = getTokenExpiration(token);
  if (!expiration) {
    console.warn('[TokenManager] Cannot parse token expiration');
    return false;
  }
  
  const now = Date.now();
  const minutesLeft = Math.floor((expiration - now) / 60000);
  
  if (minutesLeft < 0) {
    console.error('[TokenManager] Token is expired!');
    return false;
  }
  
  if (minutesLeft < 5) {
    console.warn(`[TokenManager] Token expires in ${minutesLeft} minutes!`);
  } else {
    console.log(`[TokenManager] Token valid for ${minutesLeft} more minutes`);
  }
  
  return true;
}


