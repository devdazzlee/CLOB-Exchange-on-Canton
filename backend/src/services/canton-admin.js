/**
 * Canton Admin API Service
 * Handles party registration and management via Canton Admin API
 */

// Canton Admin API endpoints - Updated to new client endpoints
const CANTON_ADMIN_HOST = process.env.CANTON_ADMIN_HOST || '65.108.40.104';
const CANTON_ADMIN_PORT = process.env.CANTON_ADMIN_PORT || '30100';
const CANTON_ADMIN_BASE = process.env.CANTON_ADMIN_BASE || `http://${CANTON_ADMIN_HOST}:${CANTON_ADMIN_PORT}`;
const CANTON_JSON_API_HOST = process.env.CANTON_JSON_API_HOST || '65.108.40.104';
const CANTON_JSON_API_PORT = process.env.CANTON_JSON_API_PORT || '31539';
const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || `http://${CANTON_JSON_API_HOST}:${CANTON_JSON_API_PORT}`;

// Keycloak token fetch hardening (network timeouts/retries)
const KEYCLOAK_TOKEN_TIMEOUT_MS = parseInt(process.env.KEYCLOAK_TOKEN_TIMEOUT_MS || '15000', 10);
const KEYCLOAK_TOKEN_RETRIES = parseInt(process.env.KEYCLOAK_TOKEN_RETRIES || '3', 10);
const KEYCLOAK_TOKEN_RETRY_BASE_DELAY_MS = parseInt(process.env.KEYCLOAK_TOKEN_RETRY_BASE_DELAY_MS || '400', 10);
// Optional (only if you *must* bypass TLS issues; keep default false)
const KEYCLOAK_ALLOW_INSECURE_TLS = (process.env.KEYCLOAK_ALLOW_INSECURE_TLS || '').toLowerCase() === 'true';

let cachedAdminToken = null;
let cachedAdminTokenExpiry = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableNetworkError(err) {
  const code = err?.cause?.code || err?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  );
}

class CantonAdminService {
  constructor() {
  }

  /**
   * Get admin authentication token
   * Uses validator-app service account token which has validator-operator permissions
   */
  async getAdminToken() {
    if (cachedAdminToken && cachedAdminTokenExpiry && Date.now() < cachedAdminTokenExpiry) {
      console.log('[CantonAdmin] Using cached admin token');
      return cachedAdminToken;
    }

    console.log('[CantonAdmin] Fetching new admin token...');

    // Get token from Keycloak using validator-app service account
    // This token has validator-operator permissions for Canton
    const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
    const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
    const KEYCLOAK_ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    const KEYCLOAK_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

    if (!KEYCLOAK_ADMIN_CLIENT_ID || !KEYCLOAK_ADMIN_CLIENT_SECRET) {
      throw new Error('KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET must be configured for Canton party registration');
    }

    const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: KEYCLOAK_ADMIN_CLIENT_ID,
      scope: 'openid profile daml_ledger_api email',
    });
    params.append('client_secret', KEYCLOAK_ADMIN_CLIENT_SECRET);

    // We use undici dispatcher to optionally allow insecure TLS if explicitly enabled.
    // Default remains secure.
    let dispatcher;
    if (KEYCLOAK_ALLOW_INSECURE_TLS) {
      try {
        const { Agent } = require('undici');
        dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      } catch {
        // If undici Agent isn't available, proceed without dispatcher (still secure)
        dispatcher = undefined;
      }
    }

    let lastErr;
    for (let attempt = 1; attempt <= KEYCLOAK_TOKEN_RETRIES; attempt++) {
      try {
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params,
          // Node 18+ supports AbortSignal.timeout
          signal: AbortSignal.timeout(KEYCLOAK_TOKEN_TIMEOUT_MS),
          ...(dispatcher ? { dispatcher } : {}),
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Retry only on 5xx/429; other errors are usually config issues.
          if ((response.status >= 500 || response.status === 429) && attempt < KEYCLOAK_TOKEN_RETRIES) {
            lastErr = new Error(`Keycloak token endpoint error ${response.status}: ${errorText}`);
            const backoff = KEYCLOAK_TOKEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            await sleep(backoff);
            continue;
          }
          throw new Error(`Failed to get validator-app token for Canton: ${errorText}`);
        }

        const data = await response.json();
        console.log('[CantonAdmin] Token response received, expires_in:', data.expires_in);
        if (!data || !data.access_token) {
          throw new Error('Validator-app token response missing access_token');
        }

        cachedAdminToken = data.access_token;
        console.log('[CantonAdmin] Admin token fetched successfully');
        // Cache slightly shorter than exp to avoid edge expiry
        const expiresIn = Number(data.expires_in || 0);
        const safetySeconds = 300; // 5 min
        cachedAdminTokenExpiry = Date.now() + (Math.max(0, expiresIn - safetySeconds) * 1000);
        return cachedAdminToken;
      } catch (err) {
        lastErr = err;
        // If it's a transient network failure, retry
        if (attempt < KEYCLOAK_TOKEN_RETRIES && isRetryableNetworkError(err)) {
          const backoff = KEYCLOAK_TOKEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await sleep(backoff);
          continue;
        }
        break;
      }
    }

    // Last-resort fallback: if we have a previously cached token, return it (may still work).
    // This prevents brief Keycloak blips from breaking the whole backend.
    if (cachedAdminToken) {
      console.warn('[CantonAdmin] Keycloak token fetch failed; using cached admin token as fallback:', lastErr?.message || lastErr);
      return cachedAdminToken;
    }

    throw lastErr || new Error('Failed to get validator-app token for Canton');

  }

  /**
   * Register a party in Canton using JSON API
   * JSON API provides HTTP endpoint /v1/parties/allocate which is a proxy for Ledger API's AllocatePartyRequest
   * This is the correct way to allocate parties via HTTP
   */
  async registerParty(partyId, displayName = null) {
    try {
      const adminToken = await this.getAdminToken();
      const grpc = new (require('./canton-grpc-client'))();
      // Prefer gRPC allocation via PartyManagementService v2
      try {
        const resp = await grpc.allocateParty(partyId, displayName || `User-${partyId.slice(0, 8)}`, adminToken);
        const allocated =
          resp?.party_details?.party ||
          resp?.party ||
          resp?.party_id ||
          partyId;
        return {
          success: true,
          partyId: allocated,
          method: 'grpc-v2',
          requestedPartyId: partyId
        };
      } catch (e) {
        // JSON API allocate endpoints are not exposed on this devnet (we get HttpMethod 404),
        // so gRPC allocation failing is a hard stop.
        console.error('[CantonAdmin] gRPC AllocateParty failed:', e.message);
        throw e;
      }
      
      // Extract party identifier (the part after ::)
      const partyIdentifier = partyId.includes('::') ? partyId.split('::')[1] : partyId;
      
      // Try multiple JSON API endpoint variations
      // The JSON API endpoint might vary by version or configuration
      const endpointsToTry = [
        `${CANTON_JSON_API_BASE}/v1/parties/allocate`,
        `${CANTON_JSON_API_BASE}/v2/parties/allocate`,
        `${CANTON_JSON_API_BASE}/parties/allocate`
      ];
      
      // JSON API party allocation MUST succeed before we grant rights.
      // If allocation endpoints are not available, we must fail fast (no lazy registration),
      // otherwise GrantUserRights will return NOT_FOUND for a non-existing party.
      const requestBody = {
        identifierHint: partyId,
        displayName: displayName || `User-${partyIdentifier.substring(0, 8)}`
      };
      
      let lastError = null;
      
      for (const jsonApiUrl of endpointsToTry) {
        try {
          const response = await fetch(jsonApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify(requestBody)
          });

          const responseText = await response.text();
          
          if (response.ok) {
            let result;
            try {
              result = JSON.parse(responseText);
            } catch (e) {
              result = { result: { identifier: partyId } };
            }
            
            const allocatedPartyId = result.result?.identifier || result.identifier || partyId;
            
            return {
              success: true,
              partyId: allocatedPartyId,
              method: 'json-api',
              requestedPartyId: partyId
            };
          }

          // If party already exists or other error, check if it's already registered
          if (response.status === 409 || response.status === 400) {
            const checkResult = await this.checkPartyExists(partyId);
            if (checkResult.exists) {
              return {
                success: true,
                partyId: partyId,
                method: 'already-registered'
              };
            }
          }
          
          lastError = `JSON API returned ${response.status}: ${responseText.substring(0, 200)}`;
          
        } catch (error) {
          lastError = error.message;
          continue;
        }
      }

      throw new Error(lastError || 'Party allocation failed: neither gRPC nor JSON API allocate endpoint succeeded');
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if a party is already registered in Canton
   * Note: This is a best-effort check. Security errors may indicate party doesn't exist or token lacks permissions.
   */
  async checkPartyExists(partyId) {
    try {
      const adminToken = await this.getAdminToken();
      
      // Try to list all parties and check if ours is in the list
      const partiesListUrl = `${CANTON_JSON_API_BASE}/v1/parties`;
      
      const response = await fetch(partiesListUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        try {
          const responseText = await response.text();
          const parties = JSON.parse(responseText);
          
          let partiesList = [];
          if (Array.isArray(parties)) {
            partiesList = parties;
          } else if (parties.result && Array.isArray(parties.result)) {
            partiesList = parties.result;
          } else if (parties.parties && Array.isArray(parties.parties)) {
            partiesList = parties.parties;
          }
          
          const partyExists = partiesList.some(p => {
            const partyIdentifier = p.identifier || p.party || p.id || p.partyId || '';
            return partyIdentifier === partyId;
          });
          
          if (partyExists) {
            return { exists: true };
          } else {
            return { exists: false };
          }
        } catch (e) {
          // Continue to try direct lookup
        }
      }

      // If listing doesn't work, try direct party lookup
      const partyInfoUrl = `${CANTON_JSON_API_BASE}/v2/parties/${encodeURIComponent(partyId)}`;
      const directResponse = await fetch(partyInfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      const responseText = await directResponse.text();
      
      // Check for security errors FIRST
      if (responseText.includes('security-sensitive error') || 
          responseText.includes('grpcCodeValue') || 
          responseText.includes('UNAUTHENTICATED') ||
          responseText.includes('"code":"NA"')) {
        return { exists: false };
      }
      
      if (directResponse.ok) {
        try {
          const partyData = JSON.parse(responseText);
          const partyIdentifier = partyData.identifier || partyData.party || partyData.id || partyData.partyId;
          if (partyData && partyIdentifier && partyIdentifier === partyId) {
            return { exists: true };
          } else if (partyData && partyIdentifier) {
            return { exists: false };
          } else if (partyData && !partyIdentifier) {
            return { exists: false };
          }
        } catch (e) {
          return { exists: false };
        }
      }

      if (directResponse.status === 404) {
        return { exists: false };
      }

      return { exists: false };
    } catch (error) {
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
      const queryUrl = `${CANTON_JSON_API_BASE}/v2/state/active-contracts`;
      
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
      return { registered: false, verified: false };
    }
  }
}

module.exports = CantonAdminService;

