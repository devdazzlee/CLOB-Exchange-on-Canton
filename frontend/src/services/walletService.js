/**
 * Wallet Service - External Party Onboarding
 * 
 * Integrates with the new v1 wallet API endpoints.
 * NO KEYCLOAK LOGIN FOR END-USERS.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

/**
 * Step 1: Generate onboarding material for external party
 * Calls POST /v1/wallets/create
 */
export async function createOnboardingMaterial({ displayName, partyHint, publicKeyBase64Der }) {
  try {
    console.log('[WalletService] Step 1: Generating onboarding material');

    const response = await fetch(`${API_BASE_URL}/v1/wallets/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName,
        partyHint,
        publicKeyBase64Der
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error?.message || errorData.error || `Failed to create onboarding material: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[WalletService] ✅ Onboarding material created:', result.data);

    return result.data;
  } catch (error) {
    console.error('[WalletService] Error creating onboarding material:', error);
    throw error;
  }
}

/**
 * Step 2: Allocate external party with user signature
 * Calls POST /v1/wallets/allocate
 */
export async function allocateExternalParty({
  partyId,
  synchronizerId,
  onboardingTransactions,
  multiHashSignature
}) {
  try {
    console.log('[WalletService] Step 2: Allocating external party');

    const response = await fetch(`${API_BASE_URL}/v1/wallets/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        partyId,
        synchronizerId,
        onboardingTransactions,
        multiHashSignature
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error?.message || errorData.error || `Failed to allocate party: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[WalletService] ✅ Party allocated:', result.data);

    return result.data;
  } catch (error) {
    console.error('[WalletService] Error allocating party:', error);
    throw error;
  }
}

/**
 * Generate authentication challenge for wallet
 * Calls POST /v1/wallets/:walletId/challenge
 */
export async function generateAuthChallenge(walletId) {
  try {
    console.log('[WalletService] Generating auth challenge for:', walletId);

    const response = await fetch(`${API_BASE_URL}/v1/wallets/${encodeURIComponent(walletId)}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error?.message || errorData.error || `Failed to generate challenge: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[WalletService] ✅ Challenge generated:', result.data);

    return result.data;
  } catch (error) {
    console.error('[WalletService] Error generating challenge:', error);
    throw error;
  }
}

/**
 * Unlock wallet with signature
 * Calls POST /v1/wallets/:walletId/unlock
 */
export async function unlockWallet(walletId, nonce, signatureBase64) {
  try {
    console.log('[WalletService] Unlocking wallet:', walletId);

    const response = await fetch(`${API_BASE_URL}/v1/wallets/${encodeURIComponent(walletId)}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nonce,
        signatureBase64
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error?.message || errorData.error || `Failed to unlock wallet: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[WalletService] ✅ Wallet unlocked:', result.data);

    return result.data;
  } catch (error) {
    console.error('[WalletService] Error unlocking wallet:', error);
    throw error;
  }
}

/**
 * Get wallet information
 * Calls GET /v1/wallets/:walletId
 */
export async function getWalletInfo(walletId) {
  try {
    console.log('[WalletService] Getting wallet info:', walletId);

    const response = await fetch(`${API_BASE_URL}/v1/wallets/${encodeURIComponent(walletId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error?.message || errorData.error || `Failed to get wallet info: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[WalletService] ✅ Wallet info retrieved:', result.data);

    return result.data;
  } catch (error) {
    console.error('[WalletService] Error getting wallet info:', error);
    throw error;
  }
}

/**
 * Store session token in localStorage
 */
export function storeSessionToken(walletId, sessionToken) {
  localStorage.setItem('canton_wallet_id', walletId);
  localStorage.setItem('canton_session_token', sessionToken);
}

/**
 * Get stored session token
 */
export function getStoredSessionToken() {
  const walletId = localStorage.getItem('canton_wallet_id');
  const sessionToken = localStorage.getItem('canton_session_token');
  return { walletId, sessionToken };
}

/**
 * Clear stored session
 */
export function clearStoredSession() {
  localStorage.removeItem('canton_wallet_id');
  localStorage.removeItem('canton_session_token');
}

/**
 * Get authorization header for authenticated requests
 */
export function getAuthHeader() {
  const { sessionToken } = getStoredSessionToken();
  return sessionToken ? `Bearer ${sessionToken}` : null;
}
