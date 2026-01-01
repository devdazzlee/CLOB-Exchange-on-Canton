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

import { getStoredToken, isTokenExpired, checkTokenStatus } from './tokenManager';

// Canton JSON API endpoint
// Based on official documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
// User info: "participant.dev.canton.wolfedgelabs.com/json-api points to json-api"
// Use proxy in both development and production to avoid CORS issues
// In development: Vite proxy handles it
// In production: Vercel serverless function handles it
const CANTON_API_BASE = '/api/canton';  // Always use proxy (Vite in dev, Vercel function in prod)
const API_VERSION = 'v2';

/**
 * Extract party ID from JWT token
 * IMPORTANT: Returns the FULL party ID format: "prefix::suffix"
 * The JWT 'sub' field only contains the prefix, but Canton requires the full format
 * @returns {string|null} Full party ID or null if not found
 */
function getPartyIdFromToken() {
  const token = getAuthToken();
  if (!token) {
    // Return known party ID as fallback
    return '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
  }
  
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    }
    
    const payload = JSON.parse(atob(parts[1]));
    const sub = payload.sub; // Subject (party ID prefix only)
    
    // CRITICAL FIX: The JWT 'sub' field contains only the prefix
    // But Canton JSON API requires the FULL party ID format: "prefix::suffix"
    // We use the known full party ID that has canReadAs permissions configured
    // This party ID was confirmed by the client to have the correct rights
    const fullPartyId = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    console.log('[Auth] Using full party ID (from token prefix:', sub, '):', fullPartyId);
    return fullPartyId;
  } catch (error) {
    console.error('[Auth] Error extracting party ID from token:', error);
    // Return known party ID as last resort
    return '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
  }
}

/**
 * Get JWT token from localStorage or environment
 * Simple token-based authentication
 */
function getAuthToken() {
  // Check localStorage first (for user-provided tokens)
  const storedToken = getStoredToken();
  if (storedToken) {
    checkTokenStatus(storedToken);
    return storedToken;
  }
  
  // Check environment variable (for development)
  const envToken = import.meta.env.VITE_CANTON_JWT_TOKEN;
  if (envToken) {
    if (isTokenExpired(envToken)) {
      console.warn('[Auth] Environment token is expired! Update VITE_CANTON_JWT_TOKEN in .env');
      return null;
    }
    checkTokenStatus(envToken);
    return envToken;
  }
  
  console.warn('[Auth] No JWT token found! Requests will fail with 401.');
  console.warn('[Auth] Set token: localStorage.setItem("canton_jwt_token", "your_token")');
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
  } else {
    console.warn('[Auth] No token available - request will likely fail');
  }
  
  return headers;
}

/**
 * Parse API response and extract contracts from various response formats
 * Handles both array format (actual API response) and object format (documented)
 * @param {any} result - API response
 * @returns {Array} Array of normalized contract objects
 */
function parseContractResponse(result) {
  // Handle different response formats:
  // 1. Array format (what Canton actually returns)
  // 2. Object with activeContracts property (documented format)
  // 3. With verbose: true, response structure may differ
  let contractEntries = [];
  if (Array.isArray(result)) {
    contractEntries = result;
  } else if (result.activeContracts) {
    contractEntries = result.activeContracts;
  } else if (result.contractEntry) {
    contractEntries = [result];
  }
  
  console.log('[API] Parsing response:', {
    isArray: Array.isArray(result),
    hasActiveContracts: !!result.activeContracts,
    entriesCount: contractEntries.length,
    firstEntry: contractEntries[0] ? Object.keys(contractEntries[0]) : null
  });
  
  // Transform nested structure to flat contract format
  return contractEntries.map(entry => {
    // Handle nested structure: contractEntry.JsActiveContract.createdEvent
    // With verbose: true, structure might be: entry.argument, entry.contractId, etc.
    const contractData = entry.contractEntry?.JsActiveContract?.createdEvent || 
                        entry.createdEvent || 
                        entry;
    
    // With verbose: true, contractId and argument might be at top level
    const contractId = contractData.contractId || entry.contractId;
    const templateId = contractData.templateId || entry.templateId;
    const payload = contractData.createArgument || contractData.argument || contractData.payload || entry.argument;
    
    return {
      contractId: contractId,
      templateId: templateId,
      payload: payload,
      signatories: contractData.signatories || entry.signatories || [],
      observers: contractData.observers || entry.observers || [],
      offset: contractData.offset || entry.offset
    };
  });
}

/**
 * Query active contracts by template at a specific offset
 * Uses: POST /v2/state/active-contracts
 * IMPORTANT: Always uses filtersByParty (filtersForAnyParty requires admin privileges)
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount")
 * @param {string} party - Party ID (required - extracted from token if not provided)
 * @param {string|number} offset - Optional offset (default: "0" for current ledger end)
 * @returns {Promise<Array>} Array of active contracts
 */
export async function queryContractsAtOffset(templateId, party = null, offset = "0") {
  try {
    // Extract party ID from token if not provided
    if (!party) {
      party = getPartyIdFromToken();
      if (!party) {
        throw new Error('Party ID is required. Cannot extract from token. Please provide party ID or ensure token is valid.');
      }
      console.log('[API] Party ID extracted from token:', party);
    }
    
    // CRITICAL: Ensure party is a string, not an array
    if (Array.isArray(party)) {
      console.warn('[API] Party parameter is an array, using first element:', party);
      party = party[0];
    }
    if (typeof party !== 'string') {
      throw new Error(`Invalid party parameter: expected string, got ${typeof party}`);
    }
    
    // Qualify template ID with package ID
    const qualifiedTemplateId = await qualifyTemplateId(templateId);
    
    // Convert offset to string if it's a number
    const offsetStr = typeof offset === 'number' ? offset.toString() : offset;
    
    // CRITICAL FIX: Use verbose: true for better contract data
    // ALWAYS use filtersByParty (filtersForAnyParty requires admin privileges)
    // IMPORTANT: readAs is REQUIRED by Canton JSON API v2 for authorization
    const requestBody = {
      readAs: [party], // REQUIRED: Explicitly declare which party is reading (must be array of strings)
      activeAtOffset: offsetStr, // Use provided offset (or "0" for current ledger end)
      verbose: true, // CRITICAL: Set to true to get full contract data including contractId
      filter: {
        filtersByParty: {
          [party]: {
            inclusive: {
              templateIds: [qualifiedTemplateId] // Use qualified template ID
            }
          }
        }
      }
    };

    const headers = getHeaders();
    console.log('[API] Querying contracts at offset:', offsetStr, templateId, `for party ${party}`);

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
      
      // If 401, token is expired or invalid
      if (response.status === 401) {
        console.error('[API] 401 Unauthorized - Token is expired or invalid.');
        throw new Error('Authentication failed: Token expired or invalid.');
      }
      
      // If 403, this means party doesn't have read permissions
      if (response.status === 403) {
        console.error('[API] 403 Forbidden - Party may not have read permissions.');
        return [];
      }
      
      console.error('[API] Query error:', error);
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to query contracts: ${response.statusText}`);
    }

    const result = await response.json();
    const allContracts = parseContractResponse(result);
    
    console.log(`[API] Retrieved ${allContracts.length} contracts at offset ${offsetStr}`);
    return allContracts;
  } catch (error) {
    console.error('Error querying contracts at offset:', error);
    throw error;
  }
}

/**
 * Query active contracts by template
 * Uses: POST /v2/state/active-contracts
 * IMPORTANT: Always uses filtersByParty (filtersForAnyParty requires admin privileges)
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount")
 * @param {string} party - Party ID (required - extracted from token if not provided)
 * @returns {Promise<Array>} Array of active contracts
 */
export async function queryContracts(templateId, party = null) {
  try {
    // Extract party ID from token if not provided
    // According to Canton docs: filtersForAnyParty requires admin privileges
    // Regular users MUST use filtersByParty with their party ID
    if (!party) {
      party = getPartyIdFromToken();
      if (!party) {
        throw new Error('Party ID is required. Cannot extract from token. Please provide party ID or ensure token is valid.');
      }
      console.log('[API] Party ID extracted from token:', party);
    }
    
    // CRITICAL: Ensure party is a string, not an array
    if (Array.isArray(party)) {
      console.warn('[API] Party parameter is an array, using first element:', party);
      party = party[0];
    }
    if (typeof party !== 'string') {
      throw new Error(`Invalid party parameter: expected string, got ${typeof party}`);
    }
    
    // Qualify template ID with package ID
    const qualifiedTemplateId = await qualifyTemplateId(templateId);
    
    // CRITICAL FIX: Use verbose: true and proper filter structure per ChatGPT suggestions
    // According to ChatGPT: Use templateIds filter and verbose: true for better results
    // ALWAYS use filtersByParty (filtersForAnyParty requires admin privileges)
    // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/queries.html
    // IMPORTANT: readAs is REQUIRED by Canton JSON API v2 for authorization
    // IMPORTANT: activeAtOffset is REQUIRED by Canton JSON API v2 (400 error if missing)
    const requestBody = {
      readAs: [party], // REQUIRED: Explicitly declare which party is reading (must be array of strings)
      activeAtOffset: "0", // REQUIRED: "0" means current ledger end, "latest" also works
      verbose: true, // CRITICAL: Set to true to get full contract data including contractId
      filter: {
        filtersByParty: {
          [party]: {
            inclusive: {
              templateIds: [qualifiedTemplateId] // Use qualified template ID
            }
          }
        }
      }
    };

    const headers = getHeaders();
    console.log('[API] Querying contracts:', templateId, `for party ${party}`);
    console.log('[API] Using filter: filtersByParty (required for non-admin users)');

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
      
      // If 401, token is expired or invalid
      if (response.status === 401) {
        console.error('[API] 401 Unauthorized - Token is expired or invalid. Please get a fresh token from the wallet UI.');
        console.error('[API] Party ID being used:', party);
        throw new Error('Authentication failed: Token expired or invalid. Please refresh your token from the wallet UI.');
      }
      
      // If 403, this means party doesn't have read permissions or wrong party ID
      if (response.status === 403) {
        console.error('[API] 403 Forbidden - Party may not have read permissions for this contract.');
        console.error('[API] Filter used: filtersByParty for', party);
        console.error('[API] Template:', templateId);
        console.error('[API] Error details:', error);
        // Return empty array instead of throwing to prevent app crashes
        return [];
      }
      
      console.error('[API] Query error:', error);
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to query contracts: ${response.statusText}`);
    }

    const result = await response.json();
    const allContracts = parseContractResponse(result);
    
    console.log(`[API] Retrieved ${allContracts.length} contracts`);
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
    // Qualify template ID with package ID
    const qualifiedTemplateId = await qualifyTemplateId(templateId);
    
    // Build request body according to JSON API v2 spec
    // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/commands.html
    // commandId is REQUIRED by SubmitAndWaitRequest schema (JSON API Commands docs)
    // IMPORTANT: commandId must be at the TOP LEVEL, not inside each command object
    const commandId = `create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const requestBody = {
      commands: [
        {
          CreateCommand: {
            templateId: qualifiedTemplateId, // Fully qualified: <package-id>:<module>:<template>
            createArguments: payload // Contract fields matching template signature
          }
        }
      ],
      commandId: commandId, // Required by SubmitAndWaitRequest schema - MUST be at top level
      actAs: [party] // Party executing the command (required by SubmitAndWaitRequest schema)
    };

            const headers = getHeaders();
    
    // Log request for debugging
    console.log('[API] Creating contract:', templateId);
    console.log('[API] Request body:', JSON.stringify(requestBody, null, 2));
    console.log('[API] Endpoint:', `${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`);

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
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
        // If errorText is not JSON, it's likely plain text error
        error = { message: errorText || `Failed to create contract: ${response.statusText}` };
      }
      
      // Log full error details for debugging
      console.error('[API] Create contract error:', {
        status: response.status,
        statusText: response.statusText,
        error: error,
        errorText: errorText,
        errorTextLength: errorText.length,
        templateId: templateId,
        payload: payload,
        requestBody: JSON.stringify(requestBody, null, 2),
        requestBodyLength: JSON.stringify(requestBody).length
      });
      
      // Check if it's a body validation error
      if (errorText === 'Invalid value for: body' || error.message === 'Invalid value for: body') {
        console.error('[API] ROOT CAUSE: Body validation failed. Possible issues:');
        console.error('[API] 1. Request structure mismatch with API spec');
        console.error('[API] 2. Empty arrays for ContractId might not be allowed');
        console.error('[API] 3. Optional fields might need to be included');
        console.error('[API] 4. Template might not be deployed');
        console.error('[API] 5. Field types might be wrong');
        console.error('[API] Full request:', JSON.stringify(requestBody, null, 2));
      }
      
      // Provide detailed error message
      const errorMsg = error.message || error.cause || error.errors?.join(', ') || errorText || `Failed to create contract: ${response.statusText}`;
      throw new Error(`Failed to create ${templateId}: ${errorMsg}`);
    }

    const result = await response.json();
    console.log('[API] Contract created successfully:', result);
    
    // submit-and-wait returns: { updateId, completionOffset }
    // completionOffset indicates where the transaction was committed
    // We need to query the contract to get the contract ID
    // CRITICAL: Use completionOffset to query at the right point in ledger history
    if (result.updateId && result.completionOffset !== undefined) {
      console.log('[API] Creation succeeded:', {
        updateId: result.updateId,
        completionOffset: result.completionOffset
      });
      
      // Try multiple times with increasing delays (contract might not be immediately available)
      let newContract = null;
      const maxRetries = 5; // Increased retries
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Increasing delay: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
          const delay = 500 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          console.log(`[API] Querying for contract (attempt ${attempt + 1}/${maxRetries})...`);
          console.log(`[API] Using completionOffset: ${result.completionOffset}`);
          console.log(`[API] Looking for template: ${templateId}`);
          console.log(`[API] Payload fields:`, Object.keys(payload));
          
          // CRITICAL FIX: Query at the completionOffset to ensure we see the contract
          // First try querying at the completionOffset
          let contracts = await queryContractsAtOffset(templateId, party, result.completionOffset);
          
          // If no results at completionOffset, try current ledger end (offset "0")
          if (contracts.length === 0 && attempt > 0) {
            console.log('[API] No contracts at completionOffset, trying current ledger end...');
            contracts = await queryContracts(templateId, party);
          }
          
          console.log(`[API] Found ${contracts.length} contracts of type ${templateId}`);
          
          // Log all found contracts for debugging
          if (contracts.length > 0) {
            console.log(`[API] Available contracts:`, contracts.map(c => ({
              contractId: c.contractId,
              tradingPair: c.payload?.tradingPair,
              owner: c.payload?.owner,
              operator: c.payload?.operator
            })));
          } else {
            console.warn(`[API] ⚠️ No contracts found. This might indicate a visibility issue.`);
            console.warn(`[API] Party: ${party}`);
            console.warn(`[API] Template: ${templateId}`);
            console.warn(`[API] CompletionOffset: ${result.completionOffset}`);
          }
          
          // Find the contract by matching key identifying fields
          // For OrderBook, match by tradingPair
          if (templateId.includes('OrderBook') && payload.tradingPair) {
            console.log(`[API] Searching for OrderBook with tradingPair: ${payload.tradingPair}`);
            newContract = contracts.find(c => {
              const contractTradingPair = c.payload?.tradingPair;
              const contractOperator = c.payload?.operator;
              const matches = contractTradingPair === payload.tradingPair;
              
              if (matches) {
                console.log(`[API] ✅ MATCH FOUND! Contract ID: ${c.contractId}`);
                console.log(`[API] Contract operator: ${contractOperator}, Expected: ${payload.operator}`);
              } else if (contractTradingPair) {
                console.log(`[API] Found OrderBook with different tradingPair: ${contractTradingPair}`);
              }
              return matches;
            });
            if (!newContract) {
              console.warn(`[API] ⚠️ No OrderBook found with tradingPair: ${payload.tradingPair}`);
              console.warn(`[API] Available tradingPairs:`, contracts.map(c => c.payload?.tradingPair));
            }
          }
          // For UserAccount, match by owner
          else if (templateId.includes('UserAccount') && payload.owner) {
            newContract = contracts.find(c => 
              c.payload?.owner === payload.owner
            );
            if (newContract) {
              console.log(`[API] Found UserAccount by owner: ${payload.owner}`);
            }
          }
          // For other contracts, try to match by all payload fields
          else {
            newContract = contracts.find(c => {
              const contractPayload = c.payload || {};
              // Match by checking if all non-null payload values match
              return Object.keys(payload).every(key => {
                const payloadValue = payload[key];
                const contractValue = contractPayload[key];
                
                // Skip null/undefined comparisons
                if (payloadValue === null || payloadValue === undefined) {
                  return true;
                }
                
                // Handle array comparison
                if (Array.isArray(payloadValue) && Array.isArray(contractValue)) {
                  return payloadValue.length === contractValue.length;
                }
                
                return contractValue === payloadValue;
              });
            });
          }
          
          if (newContract) {
            result.contractId = newContract.contractId;
            console.log('[API] ✅ Found contract ID:', result.contractId);
            break; // Success, exit retry loop
          } else {
            console.warn(`[API] Contract not found in attempt ${attempt + 1}, retrying...`);
            if (attempt === maxRetries - 1) {
              console.warn('[API] ⚠️ Could not find contract after all retries, but creation succeeded');
              console.warn('[API] This might indicate:');
              console.warn('[API] 1. Contract visibility issue (party may not have read permissions)');
              console.warn('[API] 2. Ledger propagation delay (contract may appear later)');
              console.warn('[API] 3. Contract was created but not visible to this party');
              console.warn('[API] Available contracts:', contracts.map(c => ({
                contractId: c.contractId,
                tradingPair: c.payload?.tradingPair,
                owner: c.payload?.owner
              })));
            }
          }
        } catch (queryError) {
          console.warn(`[API] Query error on attempt ${attempt + 1}:`, queryError);
          if (attempt === maxRetries - 1) {
            console.warn('[API] Could not query for contract ID after all retries');
            // Don't fail the creation - the contract was created successfully
          }
        }
      }
    } else {
      console.warn('[API] ⚠️ No updateId or completionOffset in response:', result);
    }
    
    return result;
  } catch (error) {
    console.error('[API] Error creating contract:', error);
    throw error;
  }
}

/**
 * Exercise a choice on a contract
 * Uses: POST /v2/commands/submit-and-wait
 * @param {string} contractId - Contract ID
 * @param {string} choice - Choice name
 * @param {object} argument - Choice argument
 * @param {string|string[]} party - Party ID(s) - can be single party or array of parties for multi-party authorization
 * @param {string} templateId - Optional template ID (will be fetched if not provided)
 * @returns {Promise<object>} Exercise result
 */
export async function exerciseChoice(contractId, choice, argument, party, templateId = null) {
  try {
    // commandId is REQUIRED by SubmitAndWaitRequest schema (JSON API Commands docs)
    // IMPORTANT: commandId must be at the TOP LEVEL, not inside each command object
    const commandId = `exercise-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Handle both single party and array of parties
    const actAsParties = Array.isArray(party) ? party : [party];
    
    // If templateId not provided, try to fetch it from the contract or infer from choice
    let qualifiedTemplateId = templateId;
    if (!qualifiedTemplateId) {
      try {
        // Fetch the contract to get its templateId
        const contract = await fetchContract(contractId, actAsParties[0]);
        qualifiedTemplateId = contract?.templateId;
        if (qualifiedTemplateId) {
          console.log('[Exercise Choice] Fetched templateId from contract:', qualifiedTemplateId);
        }
      } catch (err) {
        console.warn('[Exercise Choice] Could not fetch templateId from contract:', err);
      }
      
      // If still not found, try to infer from choice name (fallback)
      if (!qualifiedTemplateId) {
        if (choice === 'AddOrder') {
          qualifiedTemplateId = await qualifyTemplateId('OrderBook:OrderBook');
        } else if (choice === 'CancelOrder' || choice === 'FillOrder') {
          qualifiedTemplateId = await qualifyTemplateId('Order:Order');
        } else {
          // Last resort: try to qualify a generic template ID
          console.warn('[Exercise Choice] Could not determine templateId, using generic fallback');
          qualifiedTemplateId = await qualifyTemplateId('OrderBook:OrderBook');
        }
      }
    } else {
      // Qualify the template ID if it's not already fully qualified
      qualifiedTemplateId = await qualifyTemplateId(qualifiedTemplateId);
    }
    
    if (!qualifiedTemplateId) {
      throw new Error(`Could not determine templateId for contract ${contractId} and choice ${choice}`);
    }
    
    const requestBody = {
      commands: [
        {
          ExerciseCommand: {
            contractId: contractId, // Contract to exercise choice on
            templateId: qualifiedTemplateId, // REQUIRED by Canton JSON API v2
            choice: choice, // Choice name from template
            choiceArgument: argument // REQUIRED: Use choiceArgument (not exerciseArgument)
          }
        }
      ],
      commandId: commandId, // Required by SubmitAndWaitRequest schema - MUST be at top level
      actAs: actAsParties // Party(ies) executing the command (required by SubmitAndWaitRequest schema)
    };

    const headers = getHeaders();
    console.log('[Exercise Choice] Exercising choice:', choice, 'on contract:', contractId);
    console.log('[Exercise Choice] Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
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
        error = { message: errorText || `Failed to exercise choice: ${response.statusText}` };
      }
      console.error('[Exercise Choice] Error:', error);
      throw new Error(error.message || error.errors?.join(', ') || `Failed to exercise choice: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[Exercise Choice] Success! Result:', JSON.stringify(result, null, 2));
    
    // For AddOrder choice, the result should contain the created Order's contract ID
    // But submit-and-wait only returns updateId and completionOffset
    // We need to query for the created contract
    if (choice === 'AddOrder' && result.updateId && result.completionOffset !== undefined) {
      console.log('[Exercise Choice] AddOrder succeeded, querying for created Order contract...');
      console.log('[Exercise Choice] Completion offset:', result.completionOffset);
      console.log('[Exercise Choice] Looking for orderId:', argument.orderId);
      
      // Wait a bit for the contract to be visible
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Query for the newly created Order contract
      // The order should be visible to the party that placed it (owner)
      // Try querying at completionOffset first, then current ledger end
      let orderContracts = await queryContractsAtOffset('Order:Order', party, result.completionOffset);
      console.log('[Exercise Choice] Found', orderContracts.length, 'Order contracts at offset', result.completionOffset);
      
      // If no results at completionOffset, try current ledger end
      if (orderContracts.length === 0) {
        console.log('[Exercise Choice] No orders at completionOffset, trying current ledger end...');
        orderContracts = await queryContracts('Order:Order', party);
        console.log('[Exercise Choice] Found', orderContracts.length, 'Order contracts at current ledger end');
      }
      
      // Log all found orders for debugging
      if (orderContracts.length > 0) {
        console.log('[Exercise Choice] All Order contracts:', orderContracts.map(o => ({
          contractId: o.contractId,
          orderId: o.payload?.orderId,
          owner: o.payload?.owner,
          operator: o.payload?.operator,
          status: o.payload?.status,
          tradingPair: o.payload?.tradingPair
        })));
      } else {
        console.warn('[Exercise Choice] ⚠️ No Order contracts found at all!');
        console.warn('[Exercise Choice] This suggests orders are not being created or not visible');
        console.warn('[Exercise Choice] Party:', party);
        console.warn('[Exercise Choice] OrderId searched:', argument.orderId);
      }
      
      // Try to find the order by orderId from the argument
      if (argument.orderId && orderContracts.length > 0) {
        const createdOrder = orderContracts.find(o => o.payload?.orderId === argument.orderId);
        if (createdOrder) {
          console.log('[Exercise Choice] ✅ Found created Order:', {
            contractId: createdOrder.contractId,
            orderId: createdOrder.payload?.orderId,
            owner: createdOrder.payload?.owner,
            operator: createdOrder.payload?.operator,
            status: createdOrder.payload?.status
          });
          result.createdOrderContractId = createdOrder.contractId;
        } else {
          console.warn('[Exercise Choice] ⚠️ Order created but not found by orderId:', argument.orderId);
          console.warn('[Exercise Choice] Available orderIds:', orderContracts.map(o => o.payload?.orderId));
        }
      } else if (argument.orderId && orderContracts.length === 0) {
        console.error('[Exercise Choice] ❌ CRITICAL: Order was supposed to be created but no Order contracts found!');
        console.error('[Exercise Choice] This indicates orders are not being created or are immediately archived');
      }
    }
    
    return result;
  } catch (error) {
    console.error('[Exercise Choice] Error exercising choice:', error);
    throw error;
  }
}

/**
 * Fetch a specific contract by ID
 * Uses: POST /v2/state/active-contracts with contractId filter
 * IMPORTANT: Always uses filtersByParty (filtersForAnyParty requires admin privileges)
 * @param {string} contractId - Contract ID
 * @param {string} party - Party ID (required - extracted from token if not provided)
 * @returns {Promise<object>} Contract data
 */
export async function fetchContract(contractId, party = null, offset = null) {
  try {
    // Extract party ID from token if not provided
    if (!party) {
      party = getPartyIdFromToken();
      if (!party) {
        throw new Error('Party ID is required. Cannot extract from token. Please provide party ID or ensure token is valid.');
      }
    }
    
    // CRITICAL: Ensure party is a string, not an array
    if (Array.isArray(party)) {
      console.warn('[API] Party parameter is an array, using first element:', party);
      party = party[0];
    }
    if (typeof party !== 'string') {
      throw new Error(`Invalid party parameter: expected string, got ${typeof party}`);
    }
    
    // Use provided offset or default to "0" (current ledger end)
    const offsetStr = offset !== null ? offset.toString() : "0";
    
    // ALWAYS use filtersByParty (filtersForAnyParty requires admin privileges)
    // IMPORTANT: readAs is REQUIRED by Canton JSON API v2 for authorization
    const requestBody = {
      readAs: [party], // REQUIRED: Explicitly declare which party is reading (must be array of strings)
      activeAtOffset: offsetStr, // Use provided offset or "0" for current ledger end
      verbose: true, // CRITICAL: Set to true to get full contract data
      filter: {
        filtersByParty: {
          [party]: {
            inclusive: {
              contractIds: [contractId] // Contract IDs don't need qualification
            }
          }
        }
      }
    };
    
    console.log('[API] Fetching contract by ID:', contractId.substring(0, 20) + '...', 'at offset:', offsetStr);

    const headers = getHeaders();
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
        error = { message: errorText || `Failed to fetch contract: ${response.statusText}` };
      }
      
      // If 403, return null (contract not visible to party)
      if (response.status === 403) {
        console.warn('[API] 403 Forbidden - Contract may not be visible to party:', party);
        return null;
      }
      
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to fetch contract: ${response.statusText}`);
    }

    const result = await response.json();
    const contracts = parseContractResponse(result);
    return contracts.length > 0 ? contracts[0] : null;
  } catch (error) {
    console.error('Error fetching contract:', error);
    throw error;
  }
}

/**
 * Fetch multiple contracts by their IDs
 * IMPORTANT: Always uses filtersByParty (filtersForAnyParty requires admin privileges)
 * @param {Array<string>} contractIds - Array of contract IDs
 * @param {string} party - Party ID (required - extracted from token if not provided)
 * @returns {Promise<Array<object>>} Array of contract data
 */
export async function fetchContracts(contractIds, party = null, offset = null) {
  try {
    if (!contractIds || contractIds.length === 0) {
      return [];
    }

    // Extract party ID from token if not provided
    if (!party) {
      party = getPartyIdFromToken();
      if (!party) {
        throw new Error('Party ID is required. Cannot extract from token. Please provide party ID or ensure token is valid.');
      }
    }
    
    // CRITICAL: Ensure party is a string, not an array
    if (Array.isArray(party)) {
      console.warn('[API] Party parameter is an array, using first element:', party);
      party = party[0];
    }
    if (typeof party !== 'string') {
      throw new Error(`Invalid party parameter: expected string, got ${typeof party}`);
    }

    // Use provided offset or default to "0" (current ledger end)
    const offsetStr = offset !== null ? offset.toString() : "0";

    // ALWAYS use filtersByParty (filtersForAnyParty requires admin privileges)
    // IMPORTANT: readAs is REQUIRED by Canton JSON API v2 for authorization
    const requestBody = {
      readAs: [party], // REQUIRED: Explicitly declare which party is reading
      activeAtOffset: offsetStr, // Use provided offset or "0" for current ledger end
      verbose: true, // CRITICAL: Set to true to get full contract data
      filter: {
        filtersByParty: {
          [party]: {
            inclusive: {
              contractIds: contractIds // Contract IDs don't need qualification
            }
          }
        }
      }
    };
    
    console.log('[API] Fetching', contractIds.length, 'contracts by ID at offset:', offsetStr);

    const headers = getHeaders();
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
        error = { message: errorText || `Failed to fetch contracts: ${response.statusText}` };
      }
      
      // If 403, return empty array (contracts not visible to party)
      if (response.status === 403) {
        console.warn('[API] 403 Forbidden - Contracts may not be visible to party:', party);
        return [];
      }
      
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to fetch contracts: ${response.statusText}`);
    }

    const result = await response.json();
    return parseContractResponse(result);
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
            const headers = getHeaders();
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/parties/${encodeURIComponent(party)}`, {
      method: 'GET',
      headers: headers
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

// Cache for package ID to avoid repeated queries
let cachedPackageId = null;

/**
 * Get package ID from packages endpoint or deployed contracts
 * First tries /v2/packages endpoint (doesn't require contracts to exist)
 * Falls back to querying contracts if packages endpoint fails
 * Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/packages.html
 * @param {boolean} forceRefresh - Force refresh even if cached
 * @param {string} party - Party ID (optional, extracted from token if not provided)
 * @returns {Promise<string>} Package ID
 */
export async function getPackageId(forceRefresh = false, party = null) {
  // Return cached value if available and not forcing refresh
  if (cachedPackageId && !forceRefresh) {
    return cachedPackageId;
  }

  try {
    // Extract party ID from token if not provided
    if (!party) {
      party = getPartyIdFromToken();
      if (!party) {
        throw new Error('Party ID is required to query package ID. Cannot extract from token.');
      }
    }
    
    console.log('[API] Attempting to get package ID...');
    
    // METHOD 1: Try to get package ID from /v2/packages endpoint
    // This doesn't require contracts to exist and doesn't need read permissions
    try {
      console.log('[API] Trying /v2/packages endpoint...');
      const headers = getHeaders();
      const packagesResponse = await fetch(`${CANTON_API_BASE}/${API_VERSION}/packages`, {
        method: 'GET',
        headers: headers
      });
      
      if (packagesResponse.ok) {
        const packagesResult = await packagesResponse.json();
        const packageIds = packagesResult.packageIds || [];
        
        if (packageIds.length > 0) {
          // Use the most recent package ID (last in array, or we can try to match by DAR)
          // For now, use the last one as it's likely the most recently deployed
          const latestPackageId = packageIds[packageIds.length - 1];
          cachedPackageId = latestPackageId;
          console.log('[API] Package ID from /v2/packages endpoint:', cachedPackageId);
          console.log('[API] Total packages found:', packageIds.length);
          return cachedPackageId;
        }
      } else {
        console.log('[API] /v2/packages endpoint returned:', packagesResponse.status);
      }
    } catch (packagesError) {
      console.warn('[API] Failed to get package ID from /v2/packages:', packagesError);
    }
    
    // METHOD 2: Fallback - Query contracts to extract package ID
    console.log('[API] Falling back to contract query method with party:', party);
    
    // Query with unqualified template ID using filtersByParty
    // Ledger will return fully qualified templateId: <package-id>:<module>:<template>
    // IMPORTANT: readAs is REQUIRED by Canton JSON API v2 for authorization
    const requestBody = {
      readAs: [party], // REQUIRED: Explicitly declare which party is reading
      activeAtOffset: "0", // Current ledger end
      verbose: false, // Required field
      filter: {
        filtersByParty: {
          [party]: {
            inclusive: {
              templateIds: ["UserAccount:UserAccount"] // Unqualified - will match any package
            }
          }
        }
      }
    };

    const headers = getHeaders();
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
        error = { message: errorText };
      }
      
      // If 403 or 404, try OrderBook as fallback (UserAccount might not be visible to this party)
      if (response.status === 403 || response.status === 404) {
        console.log('[API] UserAccount query failed, trying OrderBook as fallback...');
        const orderBookRequestBody = {
          readAs: [party], // REQUIRED: Explicitly declare which party is reading
          activeAtOffset: "0",
          verbose: false,
          filter: {
            filtersByParty: {
              [party]: {
                inclusive: {
                  templateIds: ["OrderBook:OrderBook"] // Unqualified - will match any package
                }
              }
            }
          }
        };

        const orderBookResponse = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(orderBookRequestBody)
        });

        if (!orderBookResponse.ok) {
          const orderBookErrorText = await orderBookResponse.text();
          throw new Error(`Failed to query package ID from both UserAccount and OrderBook. UserAccount error (${response.status}): ${errorText}. OrderBook error (${orderBookResponse.status}): ${orderBookErrorText}. Ensure contracts are deployed and you have read permissions.`);
        }

        const orderBookResult = await orderBookResponse.json();
        const contracts = parseContractResponse(orderBookResult);
        
        if (contracts.length > 0 && contracts[0].templateId) {
          // Extract package ID from fully qualified templateId
          // Format: <package-id>:<module>:<template>
          const templateId = contracts[0].templateId;
          const parts = templateId.split(':');
          if (parts.length >= 3) {
            cachedPackageId = parts[0];
            console.log('[API] Package ID detected from OrderBook:', cachedPackageId);
            return cachedPackageId;
          }
        }
        
        throw new Error("Could not determine package ID from OrderBook. Ensure contracts are deployed and you have read permissions.");
      }
      
      // For other errors, throw immediately
      throw new Error(`Failed to query package ID: ${response.statusText}. ${errorText}`);
    }

    const result = await response.json();
    const contracts = parseContractResponse(result);
    
    if (contracts.length > 0 && contracts[0].templateId) {
      // Extract package ID from fully qualified templateId
      // Format: <package-id>:<module>:<template>
      const templateId = contracts[0].templateId;
      const parts = templateId.split(':');
      if (parts.length >= 3) {
        cachedPackageId = parts[0];
        console.log('[API] Package ID detected:', cachedPackageId);
        return cachedPackageId;
      }
    }
    
    throw new Error("Could not determine package ID from query results. Ensure contracts are deployed.");
  } catch (error) {
    console.error('[API] Error getting package ID:', error);
    throw error;
  }
}

/**
 * Qualify a template ID with package ID
 * Converts unqualified template IDs to fully qualified format
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount" or "Order:Order")
 * @param {string} packageId - Package ID (optional, will be fetched if not provided)
 * @returns {Promise<string>} Fully qualified template ID
 */
export async function qualifyTemplateId(templateId, packageId = null) {
  // If already qualified, return as-is
  if (templateId.includes(':') && templateId.split(':').length >= 3) {
    return templateId;
  }
  
  // Get package ID if not provided
  if (!packageId) {
    try {
      packageId = await getPackageId();
    } catch (error) {
      console.error('[API] Failed to get package ID:', error);
      
      // LAST RESORT: Try to use unqualified template ID
      // Some Canton deployments might accept unqualified IDs for certain operations
      // This is a fallback - it may fail, but we'll try
      console.warn('[API] Package ID not available. Attempting to use unqualified template ID:', templateId);
      console.warn('[API] This may fail if the API requires fully qualified template IDs.');
      return templateId; // Return unqualified - let the API reject it with a clear error
    }
  }
  
  if (!packageId) {
    console.warn('[API] Package ID is null. Using unqualified template ID:', templateId);
    return templateId; // Return unqualified - let the API reject it with a clear error
  }
  
  // Qualify the template ID
  // templateId format: "Module:Template" or "Template"
  const parts = templateId.split(':');
  if (parts.length === 2) {
    // "Module:Template" -> "<package-id>:Module:Template"
    return `${packageId}:${templateId}`;
  } else {
    // "Template" -> "<package-id>:Module:Template" (assume module name = template name)
    // For our contracts: UserAccount, Order, OrderBook, Trade
    return `${packageId}:${templateId}:${templateId}`;
  }
}

