/**
 * Canton Service - JSON Ledger API v2
 * 
 * NO PATCHES - Uses only documented Canton endpoints:
 * - POST /v2/commands/submit-and-wait-for-transaction (all writes)
 * - POST /v2/state/active-contracts (reads)
 * - GET /v2/synchronizers (discovery)
 * - POST /v2/parties/external/allocate (external party creation)
 * 
 * Based on:
 * - https://docs.digitalasset.com/build/3.5/reference/json-api/openapi.html
 */

const config = require("../config");
const crypto = require("crypto");

/**
 * Normalize template ID to Identifier object format required by JSON Ledger API v2
 * 
 * JSON Ledger API v2 requires templateId as an IDENTIFIER OBJECT: {packageId, moduleName, entityName}
 * NOT a string "packageId:Module:Entity"
 * 
 * The Identifier object form is the most consistently supported across Canton JSON Ledger API variants.
 * 
 * Accepts:
 * - Object: {packageId, moduleName, entityName} (returns as-is)
 * - String: "packageId:Module:Entity" (parses into object)
 * 
 * Returns: Object {packageId, moduleName, entityName}
 */
function normalizeTemplateId(templateId) {
  // If already an object with required fields, return as-is
  if (templateId && typeof templateId === "object" && templateId.packageId && templateId.moduleName && templateId.entityName) {
    return templateId;
  }
  
  // If string format, parse it into object
  if (typeof templateId === "string") {
    const parts = templateId.split(":");
    if (parts.length === 3) {
      return {
        packageId: parts[0],
        moduleName: parts[1],
        entityName: parts[2]
      };
    }
    // Handle package-name format (2 parts: package-name:Entity)
    if (parts.length === 2) {
      // This is a fallback - ideally use full format
      // We can't determine module name from package-name format alone
      throw new Error(`Invalid templateId string format: "${templateId}". Expected "packageId:ModuleName:EntityName" (3 parts)`);
    }
    throw new Error(`Invalid templateId string format: "${templateId}". Expected "packageId:Module:Entity"`);
  }
  
  throw new Error(`Invalid templateId: expected string or {packageId,moduleName,entityName}, got: ${JSON.stringify(templateId)}`);
}

/**
 * Convert templateId to string format for JSON Ledger API v2 commands
 * Commands require string format: "packageId:ModuleName:EntityName"
 */
function templateIdToString(templateId) {
  if (typeof templateId === "string") {
    return templateId;
  }
  if (templateId && typeof templateId === "object" && templateId.packageId && templateId.moduleName && templateId.entityName) {
    return `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;
  }
  throw new Error(`Invalid templateId: ${JSON.stringify(templateId)}`);
}

/**
 * Decode JWT token payload
 */
function decodeTokenPayload(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token is required to extract payload");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
  const payloadJson = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(payloadJson);
}

/**
 * Parse Canton error response and extract useful details
 */
function parseCantonError(text, status) {
  let errorData = {};
  try {
    errorData = JSON.parse(text);
  } catch (e) {
    return {
      code: 'UNKNOWN_ERROR',
      message: text,
      httpStatus: status
    };
  }

  return {
    code: errorData.code || 'UNKNOWN_ERROR',
    message: errorData.cause || errorData.message || text,
    correlationId: errorData.correlationId,
    traceId: errorData.traceId,
    context: errorData.context,
    errorCategory: errorData.errorCategory,
    httpStatus: status
  };
}

class CantonService {
  constructor() {
    this.jsonApiBase = config.canton.jsonApiBase;
    this.operatorPartyId = config.canton.operatorPartyId;
    this.synchronizerId = config.canton.synchronizerId;
    this.packageName = config.canton.packageName;
  }

  /**
   * Get template ID in package-name format
   */
  getTemplateId(entityName) {
    return `${this.packageName}:${entityName}`;
  }

  // ==========================================================================
  // COMMANDS (Writes)
  // ==========================================================================

  /**
   * Submit and wait for transaction - CANONICAL write endpoint
   * POST /v2/commands/submit-and-wait-for-transaction
   * 
   * @param {string} token - Bearer token with actAs rights
   * @param {Object} body - JsSubmitAndWaitForTransactionRequest
   * @returns {Object} JsSubmitAndWaitForTransactionResponse with transaction
   */
  async submitAndWaitForTransaction(token, body) {
    const url = `${this.jsonApiBase}/v2/commands/submit-and-wait-for-transaction`;

    console.log(`[CantonService] POST ${url}`);
    // Extract commandId from nested structure
    const commandId = body.commands?.commandId || body.commandId || 'unknown';
    console.log(`[CantonService] commandId: ${commandId}`);
    console.log(`[CantonService] Request body:`, JSON.stringify(body, null, 2));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      console.error(`[CantonService] ❌ Command failed:`, error);

      const err = new Error(error.message);
      err.code = error.code;
      err.correlationId = error.correlationId;
      err.traceId = error.traceId;
      err.httpStatus = error.httpStatus;
      throw err;
    }

    const result = JSON.parse(text);
    console.log(`[CantonService] ✅ Transaction completed: ${result.transaction?.updateId || 'unknown'}`);

    return result;
  }

  /**
   * Create a contract on the ledger
   * Uses POST /v2/commands/submit-and-wait-for-transaction with CreateCommand
   * 
   * Correct JSON Ledger API v2 structure:
   * {
   *   "commands": {
   *     "commandId": "...",
   *     "actAs": ["..."],
   *     "commands": [{
   *       "create": {
   *         "templateId": {packageId, moduleName, entityName},
   *         "createArguments": {...}
   *       }
   *     }]
   *   }
   * }
   */
  async createContract({
    token,
    actAsParty,
    templateId,
    createArguments,
    readAs = [],
    commandId = null,
    synchronizerId = null
  }) {
    const actAs = Array.isArray(actAsParty) ? actAsParty : [actAsParty];

    if (!actAs.length || !actAs[0]) {
      throw new Error("createContract: actAsParty is required");
    }
    if (!templateId) {
      throw new Error("createContract: templateId is required");
    }
    if (!createArguments) {
      throw new Error("createContract: createArguments is required");
    }

    // Convert templateId to string format (required by JSON Ledger API v2)
    const templateIdString = templateIdToString(templateId);

    // Build correct v2 API structure with top-level "commands" object
    // CRITICAL: Use "CreateCommand" (capitalized) not "create" per JSON Ledger API v2 spec
    // CRITICAL: domainId is REQUIRED when parties are on multiple synchronizers
    const body = {
      commands: {
        commandId: commandId || `cmd-create-${crypto.randomUUID()}`,
        actAs,
        ...(readAs.length > 0 && { readAs }),
        // domainId tells Canton which synchronizer to use for this transaction
        // Required when parties may be on different domains
        ...(synchronizerId && { domainId: synchronizerId }),
        commands: [{
          CreateCommand: {
            templateId: templateIdString,
            createArguments
          }
        }]
      }
    };

    return this.submitAndWaitForTransaction(token, body);
  }

  /**
   * Exercise a choice on a contract
   * Uses POST /v2/commands/submit-and-wait-for-transaction with ExerciseCommand
   * 
   * Correct JSON Ledger API v2 structure:
   * {
   *   "commands": {
   *     "commandId": "...",
   *     "actAs": ["..."],
   *     "commands": [{
   *       "exercise": {
   *         "templateId": {packageId, moduleName, entityName},
   *         "contractId": "...",
   *         "choice": "...",
   *         "choiceArgument": {...}
   *       }
   *     }]
   *   }
   * }
   */
  async exerciseChoice({
    token,
    actAsParty,
    templateId,
    contractId,
    choice,
    choiceArgument = {},
    readAs = [],
    commandId = null,
    synchronizerId = null
  }) {
    const actAs = Array.isArray(actAsParty) ? actAsParty : [actAsParty];

    if (!actAs.length || !actAs[0]) {
      throw new Error("exerciseChoice: actAsParty is required");
    }
    if (!templateId) {
      throw new Error("exerciseChoice: templateId is required");
    }
    if (!contractId) {
      throw new Error("exerciseChoice: contractId is required");
    }
    if (!choice) {
      throw new Error("exerciseChoice: choice is required");
    }

    // Convert templateId to string format (required by JSON Ledger API v2)
    const templateIdString = templateIdToString(templateId);

    // Build correct v2 API structure with top-level "commands" object
    // NOTE: synchronizerId is NOT a valid field in submit-and-wait-for-transaction
    // CRITICAL: Use "ExerciseCommand" (capitalized) not "exercise" per JSON Ledger API v2 spec
    const body = {
      commands: {
        commandId: commandId || `cmd-exercise-${crypto.randomUUID()}`,
        actAs,
        ...(readAs.length > 0 && { readAs }),
        commands: [{
          ExerciseCommand: {
            templateId: templateIdString,
            contractId,
            choice,
            choiceArgument
          }
        }]
      }
    };

    return this.submitAndWaitForTransaction(token, body);
  }

  /**
   * Alias for createContract - maintained for backward compatibility
   * @deprecated Use createContract directly
   */
  async createContractWithTransaction(options) {
    return this.createContract(options);
  }

  // ==========================================================================
  // STATE (Reads)
  // ==========================================================================

  /**
   * Get current ledger end offset
   * GET /v2/state/ledger-end
   */
  async getLedgerEndOffset(token) {
    const url = `${this.jsonApiBase}/v2/state/ledger-end`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = parseCantonError(await res.text(), res.status);
      console.error(`[CantonService] ❌ Ledger end query failed:`, error);
      throw new Error(error.message);
    }

    const result = await res.json();
    console.log(`[CantonService] ✅ Ledger end offset: ${result.offset}`);
    return result.offset;
  }

  /**
   * Lookup a single contract by contract ID
   * POST /v2/contracts/lookup
   */
  async lookupContract(contractId, token) {
    const url = `${this.jsonApiBase}/v2/contracts/lookup`;

    console.log(`[CantonService] Looking up contract: ${contractId?.substring(0, 40)}...`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        contractId: contractId
      })
    });

    if (!res.ok) {
      const error = parseCantonError(await res.text(), res.status);
      console.error(`[CantonService] ❌ Contract lookup failed:`, error);
      return null;
    }

    const result = await res.json();
    console.log(`[CantonService] ✅ Contract found`);
    
    return {
      contractId: result.contractId || contractId,
      payload: result.payload || result.argument || result.createArgument,
      templateId: result.templateId
    };
  }

  /**
   * Query active contracts
   * POST /v2/state/active-contracts
   * 
   * Note: activeAtOffset is required. If not provided, fetches from ledger-end first.
   * Supports pagination to handle large result sets (Canton has 200 element limit)
   */
  async queryActiveContracts({ party, templateIds = [], activeAtOffset = null, verbose = false, pageSize = 100, pageToken = null }, token) {
    const url = `${this.jsonApiBase}/v2/state/active-contracts`;

    // If activeAtOffset not provided, fetch from ledger-end (required field)
    let effectiveOffset = activeAtOffset;
    if (effectiveOffset === null || effectiveOffset === undefined) {
      try {
        effectiveOffset = await this.getLedgerEndOffset(token);
        console.log(`[CantonService] Using ledger-end offset: ${effectiveOffset}`);
      } catch (error) {
        console.warn(`[CantonService] Failed to get ledger-end, using 0:`, error.message);
        effectiveOffset = 0;
      }
    }

    // Build the correct v2 filter structure - SIMPLIFIED FORMAT
    // Canton JSON API v2 uses simpler filter without cumulative/identifierFilter
    const filter = {};
    
    if (party) {
      filter.filtersByParty = {
        [party]: templateIds.length > 0 ? {
          // Use templateFilters for specific templates
          templateFilters: templateIds.map(t => ({
            templateId: normalizeTemplateId(t),
            includeCreatedEventBlob: false
          }))
        } : {} // Empty object = wildcard (all templates)
      };
    } else {
      // If no party specified, use filtersForAnyParty
      filter.filtersForAnyParty = templateIds.length > 0 ? {
        templateFilters: templateIds.map(t => ({
          templateId: normalizeTemplateId(t),
          includeCreatedEventBlob: false
        }))
      } : {}; // Empty object = wildcard
    }

    const body = {
      filter: filter,
      verbose: verbose,
      activeAtOffset: effectiveOffset, // Required field
      pageSize: pageSize, // Limit results per page to avoid 200 element limit
    };
    
    // Add page token for pagination
    if (pageToken) {
      body.pageToken = pageToken;
    }

    console.log(`[CantonService] POST ${url}`);
    console.log(`[CantonService] Querying for party: ${party || 'any'}, templates: ${templateIds.join(', ') || 'all'}, offset: ${effectiveOffset}, pageSize: ${pageSize}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      
      // Handle the 200 element limit gracefully - this is NOT an error, just a Canton limitation
      // Canton JSON API has a hard limit of 200 total matching elements
      if (error.code === 'JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED') {
        console.log(`[CantonService] ℹ️ Query has 200+ contracts. Using cached data instead (Canton limit: 200)`);
        // Return empty array - caller should use cached/ReadModel data
        return [];
      }
      
      console.error(`[CantonService] ❌ Query failed:`, error);
      throw new Error(error.message);
    }

    const result = JSON.parse(text);
    const contracts = result.activeContracts || result || [];
    console.log(`[CantonService] ✅ Found ${contracts.length || 0} contracts`);

    return contracts;
  }
  
  /**
   * Query active contracts with pagination to handle large result sets
   * NOTE: Canton has a 200 TOTAL element limit before pagination.
   * This method is kept for smaller result sets that need paging.
   */
  async queryActiveContractsPaginated({ party, templateIds = [], activeAtOffset, verbose = false }, token) {
    const allContracts = [];
    let pageToken = null;
    const pageSize = 50; // Small page size
    let iterations = 0;
    const maxIterations = 10; // Safety limit
    
    do {
      const url = `${this.jsonApiBase}/v2/state/active-contracts`;
      
      const filter = {};
      if (party) {
        filter.filtersByParty = {
          [party]: templateIds.length > 0 ? {
            templateFilters: templateIds.map(t => ({
              templateId: normalizeTemplateId(t),
              includeCreatedEventBlob: false
            }))
          } : {}
        };
      } else {
        filter.filtersForAnyParty = templateIds.length > 0 ? {
          templateFilters: templateIds.map(t => ({
            templateId: normalizeTemplateId(t),
            includeCreatedEventBlob: false
          }))
        } : {};
      }

      const body = {
        filter,
        verbose,
        activeAtOffset,
        pageSize,
      };
      
      if (pageToken) {
        body.pageToken = pageToken;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorText = await res.text();
        // Check for 200 element limit - this is expected, not an error
        if (errorText.includes('JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED')) {
          console.log(`[CantonService] ℹ️ 200+ contracts found. Using cached data.`);
          return allContracts; // Return what we have so far
        }
        console.error(`[CantonService] Paginated query failed:`, errorText);
        break;
      }

      const result = await res.json();
      const contracts = result.activeContracts || [];
      allContracts.push(...contracts);
      
      pageToken = result.nextPageToken || null;
      iterations++;
      
      console.log(`[CantonService] Paginated query: got ${contracts.length} contracts (total: ${allContracts.length}), hasMore: ${!!pageToken}`);
      
    } while (pageToken && iterations < maxIterations);
    
    console.log(`[CantonService] ✅ Paginated query complete: ${allContracts.length} total contracts`);
    return allContracts;
  }

  /**
   * Convenience method: query contracts by template
   */
  async queryContracts({ templateId, party }, token) {
    return this.queryActiveContracts({
      party: party || this.operatorPartyId,
      templateIds: [templateId]
    }, token);
  }

  // ==========================================================================
  // SYNCHRONIZERS
  // ==========================================================================

  /**
   * Discover synchronizers
   * GET /v2/synchronizers
   */
  async getSynchronizers(token) {
    const url = `${this.jsonApiBase}/v2/synchronizers`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Failed to get synchronizers: ${error.message}`);
    }

    const result = JSON.parse(text);
    return result.synchronizers || [];
  }

  // ==========================================================================
  // PARTIES
  // ==========================================================================

  /**
   * Allocate an external party
   * POST /v2/parties/external/allocate
   */
  async allocateExternalParty({
    partyIdHint,
    annotations = {}
  }, token) {
    const url = `${this.jsonApiBase}/v2/parties/external/allocate`;

    const body = {
      partyIdHint,
      synchronizer: this.synchronizerId,
      localMetadata: {
        resourceVersion: "0",
        annotations: {
          app: "clob-exchange",
          ...annotations
        }
      }
    };

    console.log(`[CantonService] POST ${url}`);
    console.log(`[CantonService] Allocating party: ${partyIdHint}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      console.error(`[CantonService] ❌ Party allocation failed:`, error);
      throw new Error(`Party allocation failed: ${error.message}`);
    }

    const result = JSON.parse(text);
    console.log(`[CantonService] ✅ Party allocated: ${result.partyDetails?.party}`);

    return result.partyDetails;
  }

  /**
   * List parties
   * GET /v2/parties
   */
  async listParties(token) {
    const url = `${this.jsonApiBase}/v2/parties`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Failed to list parties: ${error.message}`);
    }

    const result = JSON.parse(text);
    return result.partyDetails || [];
  }

  // ==========================================================================
  // PACKAGES
  // ==========================================================================

  /**
   * List packages
   * GET /v2/packages
   */
  async listPackages(token) {
    const url = `${this.jsonApiBase}/v2/packages`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Failed to list packages: ${error.message}`);
    }

    const result = JSON.parse(text);
    return result.packageIds || [];
  }

  /**
   * Get package status
   * GET /v2/packages/{packageId}/status
   */
  async getPackageStatus(packageId, token) {
    const url = `${this.jsonApiBase}/v2/packages/${encodeURIComponent(packageId)}/status`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Failed to get package status: ${error.message}`);
    }

    return JSON.parse(text);
  }

  // ==========================================================================
  // INTERACTIVE SUBMISSION (External signing)
  // ==========================================================================

  /**
   * Prepare interactive submission
   * POST /v2/interactive-submission/prepare
   * 
   * Correct JSON Ledger API v2 structure with top-level "commands" object
   */
  async prepareInteractiveSubmission({
    token,
    actAsParty,
    templateId,
    contractId,
    choice,
    choiceArgument = {},
    synchronizerId = null
  }) {
    const url = `${this.jsonApiBase}/v2/interactive-submission/prepare`;
    const actAs = Array.isArray(actAsParty) ? actAsParty : [actAsParty];

    // Convert templateId to string format (required by JSON Ledger API v2)
    const templateIdString = templateIdToString(templateId);

    // Build correct v2 API structure with top-level "commands" object
    // NOTE: synchronizerId is NOT a valid field in prepare-interactive-submission
    // CRITICAL: Use "ExerciseCommand" (capitalized) not "exercise" per JSON Ledger API v2 spec
    const body = {
      commands: {
        commandId: `cmd-prep-${crypto.randomUUID()}`,
        actAs,
        commands: [{
          ExerciseCommand: {
            templateId: templateIdString,
            contractId,
            choice,
            choiceArgument
          }
        }]
      }
    };

    console.log(`[CantonService] POST ${url}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Prepare failed: ${error.message}`);
    }

    return JSON.parse(text);
  }

  /**
   * Execute interactive submission
   * POST /v2/interactive-submission/execute
   */
  async executeInteractiveSubmission({ preparedTransaction, signatures }, token) {
    const url = `${this.jsonApiBase}/v2/interactive-submission/execute`;

    const body = {
      preparedTransaction,
      signatures
    };

    console.log(`[CantonService] POST ${url}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    if (!res.ok) {
      const error = parseCantonError(text, res.status);
      throw new Error(`Execute failed: ${error.message}`);
    }

    return JSON.parse(text);
  }

  // ==========================================================================
  // UPDATES (for streaming)
  // ==========================================================================

  /**
   * Get WebSocket URL for updates streaming
   */
  getUpdatesWebSocketUrl() {
    return this.jsonApiBase
      .replace('http://', 'ws://')
      .replace('https://', 'wss://') + '/v2/updates';
  }

  /**
   * Get WebSocket URL for active contracts streaming
   */
  getActiveContractsWebSocketUrl() {
    return this.jsonApiBase
      .replace('http://', 'ws://')
      .replace('https://', 'wss://') + '/v2/state/active-contracts';
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Extract contract ID from transaction response
   */
  extractContractId(transactionResponse) {
    const events = transactionResponse?.transaction?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent;
      if (created?.contractId) {
        return created.contractId;
      }
    }
    return null;
  }

  /**
   * Extract update ID from transaction response
   */
  extractUpdateId(transactionResponse) {
    return transactionResponse?.transaction?.updateId || null;
  }

  /**
   * Get user rights via JSON Ledger API v2
   * GET /v2/users/{user-id}/rights
   * 
   * @param {string} token - Bearer token
   * @param {string} userId - User ID (from JWT 'sub' claim)
   * @returns {Object} User rights including canActAs and canReadAs
   */
  async getUserRights(token, userId) {
    const url = `${this.jsonApiBase}/v2/users/${encodeURIComponent(userId)}/rights`;
    
    console.log(`[CantonService] GET ${url}`);
    
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const text = await res.text();
      const error = parseCantonError(text, res.status);
      console.error(`[CantonService] ❌ Failed to get user rights:`, error);
      throw new Error(`Failed to get user rights: ${error.message}`);
    }

    const result = await res.json();
    console.log(`[CantonService] ✅ User rights retrieved:`, JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Grant user rights via JSON Ledger API v2
   * POST /v2/users/{user-id}/rights
   * 
   * CRITICAL: Canton JSON Ledger API v2 requires rights in 'kind' wrapper format:
   * {
   *   "rights": [
   *     { "kind": { "CanActAs": { "value": { "party": "..." } } } },
   *     { "kind": { "CanReadAs": { "value": { "party": "..." } } } }
   *   ]
   * }
   * 
   * @param {string} token - Bearer token
   * @param {string} userId - User ID (from JWT 'sub' claim)
   * @param {Array<string>} partyIds - Array of party IDs to grant rights for
   * @param {string} identityProviderId - Identity provider ID (empty string for default IDP)
   * @returns {Object} Grant result
   */
  async grantUserRights(token, userId, partyIds, identityProviderId = "") {
    const url = `${this.jsonApiBase}/v2/users/${encodeURIComponent(userId)}/rights`;
    
    // Build rights array with CORRECT 'kind' wrapper format
    // Canton JSON Ledger API v2 requires: { kind: { CanActAs: { value: { party } } } }
    const rights = [];
    for (const partyId of partyIds) {
      rights.push({ 
        kind: { 
          CanActAs: { 
            value: { party: partyId } 
          } 
        } 
      });
      rights.push({ 
        kind: { 
          CanReadAs: { 
            value: { party: partyId } 
          } 
        } 
      });
    }
    
    // CRITICAL: Canton JSON API v2 requires userId AND identityProviderId in the body
    const body = { 
      userId, 
      identityProviderId, // Required field - use discovered IDP or empty string for default
      rights 
    };
    
    console.log(`[CantonService] POST ${url}`);
    console.log(`[CantonService] Granting rights for user ${userId}, parties:`, partyIds);
    console.log(`[CantonService] Request body:`, JSON.stringify(body, null, 2));
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      const error = parseCantonError(text, res.status);
      console.error(`[CantonService] ❌ Failed to grant user rights:`, error);
      throw new Error(`Failed to grant user rights: ${error.message}`);
    }

    const result = await res.json();
    console.log(`[CantonService] ✅ User rights granted:`, JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Parse user rights response from Canton JSON Ledger API v2
   * Handles the 'kind' wrapper format and normalizes to simple format
   * 
   * Input format from API:
   * { "rights": [{ "kind": { "CanActAs": { "value": { "party": "..." } } } }] }
   * 
   * Output format (normalized):
   * { "canActAs": ["party1", "party2"], "canReadAs": ["party1", "party3"] }
   */
  parseUserRights(rightsResponse) {
    const result = {
      canActAs: [],
      canReadAs: []
    };

    const rights = rightsResponse.rights || [];
    for (const right of rights) {
      // Handle 'kind' wrapper format (Canton JSON Ledger API v2)
      if (right.kind) {
        if (right.kind.CanActAs?.value?.party) {
          result.canActAs.push(right.kind.CanActAs.value.party);
        }
        if (right.kind.CanReadAs?.value?.party) {
          result.canReadAs.push(right.kind.CanReadAs.value.party);
        }
      }
      // Also handle direct format for backwards compatibility
      if (right.canActAs?.party) {
        result.canActAs.push(right.canActAs.party);
      }
      if (right.canReadAs?.party) {
        result.canReadAs.push(right.canReadAs.party);
      }
      // Handle can_act_as format (snake_case variant)
      if (right.can_act_as?.party) {
        result.canActAs.push(right.can_act_as.party);
      }
      if (right.can_read_as?.party) {
        result.canReadAs.push(right.can_read_as.party);
      }
    }

    return result;
  }
}

const cantonServiceInstance = new CantonService();
module.exports = cantonServiceInstance;
module.exports.CantonService = CantonService;
module.exports.decodeTokenPayload = decodeTokenPayload;
module.exports.parseUserRights = cantonServiceInstance.parseUserRights.bind(cantonServiceInstance);