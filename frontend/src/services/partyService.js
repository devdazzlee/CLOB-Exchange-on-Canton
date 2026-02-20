/**
 * Party Creation Service — External Party Onboarding
 * 
 * Uses 2-step flow for external party creation:
 *   1. generateTopology() — generates topology transactions
 *   2. allocatePartyWithSignature() — user signs & party is allocated
 * 
 * External parties ensure users control their own private keys
 * with Confirmation permission (non-custodial).
 */

import { getOrCreateUserId } from './userId';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

/**
 * Step 1: Generate topology
 * @param {string} publicKeyBase64 - Public key as base64
 * @param {string} partyHint - Optional party hint
 * @returns {Promise<{step: "TOPOLOGY", multiHash, topologyTransactions, ...}>}
 */
export async function generateTopology(publicKeyBase64, partyHint) {
  try {
    console.log('[PartyService] Step 1: Generating topology');

    const response = await fetch(`${API_BASE_URL}/onboarding/allocate-party`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': getOrCreateUserId(),
      },
      body: JSON.stringify({
        publicKeyBase64,
        partyHint,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Failed to generate topology: ${response.statusText}`);
    }

    const responseJson = await response.json();
    const result = responseJson?.data ?? responseJson;

    console.log('[PartyService] Topology generated:', result);

    return result;
  } catch (error) {
    console.error('[PartyService] Error generating topology:', error);
    throw error;
  }
}

/**
 * Step 2: Allocate party with signature
 * @param {string} publicKeyBase64 - Public key as base64
 * @param {string} signatureBase64 - Signature as base64
 * @param {Array} topologyTransactions - Transactions from step 1
 * @param {string} publicKeyFingerprint - Public key fingerprint from step 1
 * @returns {Promise<{step: "ALLOCATED", partyId, synchronizerId}>}
 */
export async function allocatePartyWithSignature(publicKeyBase64, signatureBase64, topologyTransactions, publicKeyFingerprint) {
  try {
    console.log('[PartyService] Step 2: Allocating party with signature');

    const response = await fetch(`${API_BASE_URL}/onboarding/allocate-party`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': getOrCreateUserId(),
      },
      body: JSON.stringify({
        publicKeyBase64,
        signatureBase64,
        topologyTransactions,
        publicKeyFingerprint,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Failed to allocate party: ${response.statusText}`);
    }

    const responseJson = await response.json();
    const result = responseJson?.data ?? responseJson;

    console.log('[PartyService] Party allocated:', result);

    return result;
  } catch (error) {
    console.error('[PartyService] Error allocating party:', error);
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
        'x-user-id': getOrCreateUserId(),
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
