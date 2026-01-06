/**
 * Canton Admin API Service
 * Handles party registration and management via Canton Admin API
 */

const CANTON_ADMIN_BASE = process.env.CANTON_ADMIN_BASE || 'https://participant.dev.canton.wolfedgelabs.com';
const CANTON_ADMIN_GRPC_PORT = process.env.CANTON_ADMIN_GRPC_PORT || '443';
const CANTON_ADMIN_HTTP_PORT = process.env.CANTON_ADMIN_HTTP_PORT || '443';

class CantonAdminService {
  constructor() {
    this.adminToken = null;
    this.adminTokenExpiry = null;
  }

  /**
   * Get admin authentication token
   * Uses the service token that has admin permissions
   */
  async getAdminToken() {
    if (this.adminToken && this.adminTokenExpiry && Date.now() < this.adminTokenExpiry) {
      return this.adminToken;
    }

    // Use the static ledger token which has admin permissions
    const TokenExchangeService = require('./token-exchange');
    const tokenExchange = new TokenExchangeService();
    this.adminToken = tokenExchange.staticLedgerToken;
    // Set expiry to 1 hour (tokens typically last longer, but refresh for safety)
    this.adminTokenExpiry = Date.now() + (60 * 60 * 1000);
    
    return this.adminToken;
  }

  /**
   * Register a party in Canton using HTTP Admin API
   * This is the proper way to register parties - no workarounds
   */
  async registerParty(partyId, displayName = null) {
    try {
      const adminToken = await this.getAdminToken();
      
      // Extract party identifier (the part after ::)
      const partyIdentifier = partyId.includes('::') ? partyId.split('::')[1] : partyId;
      const partyPrefix = partyId.includes('::') ? partyId.split('::')[0] : null;
      
      // Try HTTP Admin API first (if available)
      const httpUrl = `${CANTON_ADMIN_BASE}/admin/parties/allocate`;
      
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          partyId: partyId,
          displayName: displayName || `User-${partyIdentifier.substring(0, 8)}`
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[CantonAdmin] Party registered successfully via HTTP API:', partyId);
        return {
          success: true,
          partyId: result.partyId || partyId,
          method: 'http'
        };
      }

      // If HTTP API doesn't work, try JSON API v2 party allocation
      // Some Canton setups expose party allocation via JSON API
      const jsonApiUrl = `${CANTON_ADMIN_BASE}/json-api/v2/parties/allocate`;
      
      const jsonApiResponse = await fetch(jsonApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          partyId: partyId,
          displayName: displayName || `User-${partyIdentifier.substring(0, 8)}`
        })
      });

      if (jsonApiResponse.ok) {
        const result = await jsonApiResponse.json();
        console.log('[CantonAdmin] Party registered successfully via JSON API:', partyId);
        return {
          success: true,
          partyId: result.partyId || partyId,
          method: 'json-api'
        };
      }

      // If both fail, check if party already exists
      const checkResult = await this.checkPartyExists(partyId);
      if (checkResult.exists) {
        console.log('[CantonAdmin] Party already registered:', partyId);
        return {
          success: true,
          partyId: partyId,
          method: 'already-registered'
        };
      }

      // If all methods fail, throw error
      const errorText = await jsonApiResponse.text().catch(() => 'Unknown error');
      throw new Error(`Failed to register party: ${errorText}`);
      
    } catch (error) {
      console.error('[CantonAdmin] Error registering party:', error);
      throw error;
    }
  }

  /**
   * Check if a party is already registered in Canton
   */
  async checkPartyExists(partyId) {
    try {
      const adminToken = await this.getAdminToken();
      
      // Try to query party info
      const partyInfoUrl = `${CANTON_ADMIN_BASE}/json-api/v2/parties/${encodeURIComponent(partyId)}`;
      
      const response = await fetch(partyInfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });

      if (response.ok) {
        return { exists: true };
      }

      if (response.status === 404) {
        return { exists: false };
      }

      // If we can't determine, assume it doesn't exist
      return { exists: false };
    } catch (error) {
      console.warn('[CantonAdmin] Could not check party existence:', error.message);
      return { exists: false };
    }
  }

  /**
   * Verify party registration by attempting a query
   * This is the most reliable way to check if a party is registered
   */
  async verifyPartyRegistration(partyId, token) {
    try {
      // Try a simple query to verify the party can access the ledger
      const queryUrl = `${CANTON_ADMIN_BASE}/json-api/v2/state/active-contracts`;
      
      const response = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          readAs: [partyId],
          activeAtOffset: "0",
          verbose: false,
          filter: {
            filtersByParty: {
              [partyId]: {
                inclusive: {
                  templateIds: []
                }
              }
            }
          }
        })
      });

      // If we get a response (even empty), the party is registered
      // If we get a security error, the party is not registered
      if (response.ok || response.status === 200) {
        return { registered: true, verified: true };
      }

      if (response.status === 403 || response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.cause && errorData.cause.includes('security')) {
          return { registered: false, verified: true };
        }
      }

      // If we can't determine, assume registered (optimistic)
      return { registered: true, verified: false };
    } catch (error) {
      console.warn('[CantonAdmin] Could not verify party registration:', error.message);
      return { registered: false, verified: false };
    }
  }
}

module.exports = CantonAdminService;

