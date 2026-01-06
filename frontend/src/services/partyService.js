/**
 * Party Creation Service
 * Handles creating party IDs on behalf of users through the backend API
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a party ID on behalf of the user
 * @param {Uint8Array} publicKey - User's public key
 * @returns {Promise<{partyId: string, token?: string, quotaStatus: object}>}
 */
export async function createPartyForUser(publicKey) {
  try {
    // Convert public key to hex string
    const publicKeyHex = bytesToHex(publicKey);
    
    console.log('[PartyService] Creating party for public key:', publicKeyHex.substring(0, 20) + '...');
    
    const response = await fetch(`${API_BASE_URL}/create-party`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publicKeyHex: publicKeyHex,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      
      if (response.status === 429) {
        // Quota exceeded
        throw new Error(errorData.error || 'Daily or weekly quota exceeded. Please try again later.');
      }
      
      throw new Error(errorData.error || `Failed to create party: ${response.statusText}`);
    }

    const result = await response.json();
    
    // ============================================
    // CRITICAL DEBUG: Log the full response
    // ============================================
    console.log('[PartyService] ===== BACKEND RESPONSE RECEIVED =====');
    console.log('[PartyService] Full response object:', result);
    console.log('[PartyService] Response keys:', Object.keys(result));
    console.log('[PartyService] result.partyId:', result.partyId);
    console.log('[PartyService] result.token exists:', !!result.token);
    console.log('[PartyService] result.token type:', typeof result.token);
    console.log('[PartyService] result.token value:', result.token);
    console.log('[PartyService] result.token length:', result.token?.length);
    console.log('[PartyService] result.quotaStatus:', result.quotaStatus);
    
    // Validate token before returning
    if (result.token) {
      console.log('[PartyService] ✓ Token is present in response');
      console.log('[PartyService] Token preview:', result.token.substring(0, 50) + '...');
    } else {
      console.error('[PartyService] ✗ CRITICAL: Token is MISSING from response!');
      console.error('[PartyService] Response object:', JSON.stringify(result, null, 2));
    }
    console.log('[PartyService] ======================================');
    
    console.log('[PartyService] Party created successfully:', result.partyId);
    
    return result;
  } catch (error) {
    console.error('[PartyService] Error creating party:', error);
    throw error;
  }
}

/**
 * Get quota status
 * @returns {Promise<{daily: object, weekly: object}>}
 */
export async function getQuotaStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/quota-status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get quota status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PartyService] Error getting quota status:', error);
    throw error;
  }
}

