/**
 * Canton JSON Ledger API v2 integration
 * Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
 * Base URL: https://participant.dev.canton.wolfedgelabs.com/json-api
 * 
 * Official endpoints:
 * - /v2/state/active-contracts - Query active contracts
 * - /v2/commands/submit-and-wait - Submit commands (create, exercise)
 * - /v2/updates - Query transactions/updates
 * - /v2/parties - Party management
 */

// Canton JSON API endpoint
// Based on official documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
// User info: "participant.dev.canton.wolfedgelabs.com/json-api points to json-api"
// Use proxy in development to avoid CORS issues
const CANTON_API_BASE = import.meta.env.DEV 
  ? '/api/canton'  // Use Vite proxy in development (rewrites to /json-api)
  : 'https://participant.dev.canton.wolfedgelabs.com/json-api';  // Direct in production
const API_VERSION = 'v2';

/**
 * Get JWT token from localStorage or environment
 * For production, you may want to implement proper authentication flow
 */
function getAuthToken() {
  // Check localStorage first (for user-provided tokens)
  const storedToken = localStorage.getItem('canton_jwt_token');
  if (storedToken) {
    console.log('[Auth] Using token from localStorage');
    return storedToken;
  }
  
  // Check environment variable (for development)
  // Note: Vite exposes env vars with VITE_ prefix
  const envToken = import.meta.env.VITE_CANTON_JWT_TOKEN;
  if (envToken) {
    console.log('[Auth] Using token from environment variable');
    return envToken;
  }
  
  console.warn('[Auth] No JWT token found! Requests will fail with 401.');
  return null;
}

/**
 * Get headers with authentication if token is available
 */
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    console.log('[Auth] Added Authorization header');
  } else {
    console.warn('[Auth] No token available - request will likely fail');
  }
  
  return headers;
}

/**
 * Query active contracts by template
 * Uses: POST /v2/state/active-contracts
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount")
 * @param {string} party - Party ID (optional, for filtering by specific party)
 * @returns {Promise<Array>} Array of active contracts
 */
export async function queryContracts(templateId, party = null) {
  try {
    // ALWAYS use filtersForAnyParty to avoid 403 errors
    // Filter by party client-side if needed
    const requestBody = {
      activeAtOffset: "0", // "0" means "current ledger end" (must be string representation of Long)
      verbose: false, // Required field: whether to include event metadata
      filter: {
        filtersForAnyParty: {
          inclusive: {
            templateIds: [templateId]
          }
        }
      }
    };

    const headers = getHeaders();
    console.log('[API] Querying contracts:', templateId, party ? `will filter for party ${party}` : 'for any party');

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to query contracts: ${response.statusText}` };
      }
      
      // If 403, return empty array (token may not have query permissions)
      if (response.status === 403) {
        console.warn('[API] 403 Forbidden - token may not have query permissions. Returning empty results.');
        return [];
      }
      
      console.error('[API] Query error:', error);
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to query contracts: ${response.statusText}`);
    }

    const result = await response.json();
    const allContracts = result.activeContracts || [];
    
    // If party was specified, filter client-side
    if (party) {
      const filteredContracts = allContracts.filter(contract => {
        const signatories = contract.signatories || [];
        const observers = contract.observers || [];
        // Also check payload for userId field (for UserAccount, Order contracts)
        const userId = contract.payload?.userId;
        return signatories.includes(party) || observers.includes(party) || userId === party;
      });
      
      console.log(`[API] Filtered ${filteredContracts.length} contracts for party ${party} from ${allContracts.length} total`);
      return filteredContracts;
    }
    
    return allContracts;
  } catch (error) {
    console.error('Error querying contracts:', error);
    throw error;
  }
}

/**
 * Create a new contract on the ledger
 * Uses: POST /v2/commands/submit-and-wait
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount")
 * @param {object} payload - Contract payload
 * @param {string} party - Party ID
 * @returns {Promise<object>} Created contract result
 */
export async function createContract(templateId, payload, party) {
  try {
    const requestBody = {
      commands: [
        {
          CreateCommand: {
            templateId: templateId,
            createArguments: payload
          }
        }
      ],
      actAs: [party]
    };

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to create contract: ${response.statusText}` };
      }
      throw new Error(error.message || error.errors?.join(', ') || `Failed to create contract: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error creating contract:', error);
    throw error;
  }
}

/**
 * Exercise a choice on a contract
 * Uses: POST /v2/commands/submit-and-wait
 * @param {string} contractId - Contract ID
 * @param {string} choice - Choice name
 * @param {object} argument - Choice argument
 * @param {string} party - Party ID
 * @returns {Promise<object>} Exercise result
 */
export async function exerciseChoice(contractId, choice, argument, party) {
  try {
    const requestBody = {
      commands: [
        {
          ExerciseCommand: {
            contractId: contractId,
            choice: choice,
            exerciseArgument: argument
          }
        }
      ],
      actAs: [party]
    };

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to exercise choice: ${response.statusText}` };
      }
      throw new Error(error.message || error.errors?.join(', ') || `Failed to exercise choice: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error exercising choice:', error);
    throw error;
  }
}

/**
 * Fetch a specific contract by ID
 * Uses: POST /v2/state/active-contracts with contractId filter
 * @param {string} contractId - Contract ID
 * @returns {Promise<object>} Contract data
 */
export async function fetchContract(contractId) {
  try {
    // Use active-contracts endpoint with contractId filter
    // Use backwards compatible format: filter + verbose
    // Use filtersForAnyParty since we don't know which party owns the contract
    const requestBody = {
      activeAtOffset: "0", // "0" means "current ledger end" (must be string representation of Long)
      verbose: false, // Required field: whether to include event metadata
      filter: {
        filtersForAnyParty: {
          inclusive: {
            contractIds: [contractId]
          }
        }
      }
    };

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to fetch contract: ${response.statusText}` };
      }
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to fetch contract: ${response.statusText}`);
    }

    const result = await response.json();
    // Return first contract if found
    const contracts = result.activeContracts || [];
    return contracts.length > 0 ? contracts[0] : null;
  } catch (error) {
    console.error('Error fetching contract:', error);
    throw error;
  }
}

/**
 * Fetch multiple contracts by their IDs
 * @param {Array<string>} contractIds - Array of contract IDs
 * @returns {Promise<Array<object>>} Array of contract data
 */
export async function fetchContracts(contractIds) {
  try {
    if (!contractIds || contractIds.length === 0) {
      return [];
    }

    // Use active-contracts endpoint with multiple contractIds
    // Use backwards compatible format: filter + verbose
    // Use filtersForAnyParty since we don't know which parties own the contracts
    const requestBody = {
      activeAtOffset: "0", // "0" means "current ledger end" (must be string representation of Long)
      verbose: false, // Required field: whether to include event metadata
      filter: {
        filtersForAnyParty: {
          inclusive: {
            contractIds: contractIds
          }
        }
      }
    };

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to fetch contracts: ${response.statusText}` };
      }
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to fetch contracts: ${response.statusText}`);
    }

    const result = await response.json();
    return result.activeContracts || [];
  } catch (error) {
    console.error('Error fetching contracts:', error);
    throw error;
  }
}

/**
 * Get party details
 * Uses: GET /v2/parties/{party-id}
 * @param {string} party - Party ID
 * @returns {Promise<object>} Party information
 */
export async function getPartyDetails(party) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/parties/${encodeURIComponent(party)}`, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to get party details: ${response.statusText}` };
      }
      throw new Error(error.message || error.errors?.join(', ') || `Failed to get party details: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting party details:', error);
    throw error;
  }
}

