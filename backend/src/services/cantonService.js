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
  
  // If string format, check if it uses "#" prefix (package name format)
  // Canton allows "#package-name:Module:Entity" format - keep as string
  if (typeof templateId === "string") {
    // If it starts with "#", it's using package name format - return as-is (string)
    if (templateId.startsWith("#")) {
      return templateId; // Keep as string for API
    }
    
    // Otherwise, parse into object format
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
    synchronizerId = null,
    disclosedContracts = null
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
        }],
        // Include disclosed contracts if provided (needed for Splice Token Standard transfers)
        ...(disclosedContracts && disclosedContracts.length > 0 && { disclosedContracts })
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
   * Get all packages
   * GET /v2/packages
   */
  async getPackages(token) {
    const url = `${this.jsonApiBase}/v2/packages`;

    console.log(`[CantonService] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = parseCantonError(await res.text(), res.status);
      console.error(`[CantonService] ❌ Get packages failed:`, error);
      throw new Error(error.message);
    }

    const result = await res.json();
    // Handle different response formats
    // Canton returns { packageIds: [...] } not a direct array
    let packages = [];
    if (Array.isArray(result)) {
      packages = result;
    } else if (result.packageIds && Array.isArray(result.packageIds)) {
      packages = result.packageIds;
    } else if (result.packages && Array.isArray(result.packages)) {
      packages = result.packages;
    }
    
    console.log(`[CantonService] ✅ Found ${packages.length || 0} packages`);
    return packages;
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
  async queryActiveContracts({ party, templateIds = [], interfaceIds = [], activeAtOffset = null, verbose = false, pageSize = 100, pageToken = null, _splitQuery = false }, token) {
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

    // Build the correct v2 filter structure using CUMULATIVE format
    // IMPORTANT: The 'cumulative' format with TemplateFilter inside identifierFilter
    // correctly returns only matching contracts and avoids the 413 error.
    // The simpler 'templateFilters' format triggers 413 when total contracts > 200.
    const filter = {};
    
    if (party) {
      // Separate interfaces from templates (interfaces start with "#")
      const allIds = [...interfaceIds, ...templateIds];
      const interfaces = allIds.filter(t => typeof t === 'string' && t.startsWith('#'));
      const templates = allIds.filter(t => !(typeof t === 'string' && t.startsWith('#')));
      
      const filters = [];
      
      // Add interface filters (per client instructions - use InterfaceFilter)
      if (interfaces.length > 0) {
        filters.push(...interfaces.map(interfaceId => ({
          identifierFilter: {
            InterfaceFilter: {
              value: {
                interfaceId: interfaceId, // Keep as string with # prefix
                includeCreatedEventBlob: true,
                includeInterfaceView: true
              }
            }
          }
        })));
      }
      
      // Add template filters
      if (templates.length > 0) {
        filters.push(...templates.map(t => ({
            identifierFilter: {
              TemplateFilter: {
                value: {
                  templateId: typeof t === 'string' ? t : `${t.packageId}:${t.moduleName}:${t.entityName}`,
                  includeCreatedEventBlob: false
                }
              }
            }
        })));
      }
      
      filter.filtersByParty = {
        [party]: filters.length > 0 ? {
          cumulative: filters
        } : {
          // Wildcard filter for all templates
          cumulative: [{
            identifierFilter: {
              WildcardFilter: {
                value: {
                  includeCreatedEventBlob: false
                }
              }
            }
          }]
        }
      };
    } else {
      // If no party specified, use filtersForAnyParty
      // Separate interfaces from templates
      const allIds = [...interfaceIds, ...templateIds];
      const interfaces = allIds.filter(t => typeof t === 'string' && t.startsWith('#'));
      const templates = allIds.filter(t => !(typeof t === 'string' && t.startsWith('#')));
      
      const filters = [];
      
      // Add interface filters
      if (interfaces.length > 0) {
        filters.push(...interfaces.map(interfaceId => ({
          identifierFilter: {
            InterfaceFilter: {
              value: {
                interfaceId: interfaceId,
                includeCreatedEventBlob: true,
                includeInterfaceView: true
              }
            }
          }
        })));
      }
      
      // Add template filters
      if (templates.length > 0) {
        filters.push(...templates.map(t => ({
          identifierFilter: {
            TemplateFilter: {
              value: {
                templateId: typeof t === 'string' ? t : `${t.packageId}:${t.moduleName}:${t.entityName}`,
                includeCreatedEventBlob: false
              }
            }
          }
        })));
      }
      
      filter.filtersForAnyParty = filters.length > 0 ? {
        cumulative: filters
      } : {
        cumulative: [{
          identifierFilter: {
            WildcardFilter: {
              value: {
                includeCreatedEventBlob: false
              }
            }
          }
        }]
      };
    }

    // ─── Pagination loop ─────────────────────────────────────────────────
    // Canton JSON API v2 has a hard limit of ~200 total elements per response.
    // We use a smaller pageSize and follow nextPageToken to get ALL results.
    // ────────────────────────────────────────────────────────────────────
    const allContracts = [];
    let currentPageToken = pageToken || null;
    let effectivePageSize = Math.min(pageSize, 100); // Cap at 100 to stay under 200 limit
    let iterations = 0;
    const maxIterations = 20; // Safety limit (20 × 100 = 2000 contracts max)
    let loggedQuery = false;

    // Use while(true) with explicit breaks so that 'continue' for page-size
    // retries works correctly (a do-while condition would exit on null pageToken).
    while (iterations < maxIterations) {
    const body = {
      filter: filter,
      verbose: verbose,
        activeAtOffset: effectiveOffset,
        pageSize: effectivePageSize,
      };
      
      if (currentPageToken) {
        body.pageToken = currentPageToken;
      }

      if (!loggedQuery) {
        console.log(`[CantonService] Querying for party: ${party || 'any'}, templates: ${templateIds.join(', ') || 'all'}, offset: ${effectiveOffset}, pageSize: ${effectivePageSize}`);
        loggedQuery = true;
      }

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
      
      // Handle the 200 element limit
      if (error.code === 'JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED') {
        // If we have multiple templates, split into individual queries and merge
        const currentTemplateIds = templateIds.filter(t => !(typeof t === 'string' && t.startsWith('#')));
        if (currentTemplateIds.length > 1 && !body._splitQuery) {
          console.log(`[CantonService] ℹ️ 200+ contracts with ${currentTemplateIds.length} templates. Splitting into individual queries...`);
          const mergedResults = [];
          for (const singleTemplate of currentTemplateIds) {
            try {
              const singleResult = await this.queryActiveContracts({
                party, templateIds: [singleTemplate], interfaceIds: interfaceIds || [],
                activeAtOffset: effectiveOffset, verbose, pageSize: effectivePageSize,
                pageToken: null, _splitQuery: true
              }, token);
              if (Array.isArray(singleResult)) {
                mergedResults.push(...singleResult);
              }
            } catch (splitErr) {
              console.warn(`[CantonService] ⚠️ Split query for ${singleTemplate} failed: ${splitErr.message}`);
            }
          }
          console.log(`[CantonService] ✅ Split query returned ${mergedResults.length} total contracts`);
          return mergedResults;
        }
        
        // Single template but still 200+ — try to get partial results
        console.warn(`[CantonService] ⚠️ 200+ contracts for single template query (pageSize=${effectivePageSize}). Raw error: ${text.substring(0, 200)}`);
        try {
          const errorResult = JSON.parse(text);
          const partialContracts = errorResult.activeContracts || [];
          if (partialContracts.length > 0) {
            allContracts.push(...this._normalizeContracts(partialContracts));
            console.log(`[CantonService] 📋 Extracted ${partialContracts.length} partial contracts from error response`);
          }
          if (errorResult.nextPageToken) {
            currentPageToken = errorResult.nextPageToken;
            effectivePageSize = Math.min(effectivePageSize, 50);
            iterations++;
            continue;
          }
        } catch (_) { /* Can't parse error response */ }
        break;
      }
      
      console.error(`[CantonService] ❌ Query failed:`, error);
      throw new Error(error.message);
    }

    const result = JSON.parse(text);
    const rawContracts = result.activeContracts || result || [];
      
      allContracts.push(...this._normalizeContracts(rawContracts));
      
      // Check for next page
      currentPageToken = result.nextPageToken || null;
      iterations++;
      
      if (currentPageToken) {
        if (iterations > 1) {
          console.log(`[CantonService] 📄 Page ${iterations}: +${rawContracts.length} contracts (total: ${allContracts.length})`);
        }
      } else {
        // No more pages — exit loop
        break;
      }
    }

    console.log(`[CantonService] ✅ Found ${allContracts.length} contracts${iterations > 1 ? ` (${iterations} pages)` : ''}`);
    return allContracts;
  }

  /**
   * Normalize Canton JSON API v2 contract format to a simple flat format.
   * Canton wraps contracts in: [{contractEntry: {JsActiveContract: {createdEvent: {...}}}}]
   */
  _normalizeContracts(rawContracts) {
    return (Array.isArray(rawContracts) ? rawContracts : []).map(item => {
      if (item.contractEntry?.JsActiveContract) {
        const activeContract = item.contractEntry.JsActiveContract;
        const createdEvent = activeContract.createdEvent || {};
        return {
          contractId: createdEvent.contractId,
          templateId: createdEvent.templateId,
          payload: createdEvent.createArgument,
          createArgument: createdEvent.createArgument,
          signatories: createdEvent.signatories,
          observers: createdEvent.observers,
          witnessParties: createdEvent.witnessParties,
          offset: createdEvent.offset,
          synchronizerId: activeContract.synchronizerId,
          createdAt: createdEvent.createdAt
        };
      }
      return item;
    });
  }
  
  /**
   * Query active contracts with pagination to handle large result sets
   * NOTE: Canton has a 200 TOTAL element limit before pagination.
   * This method is kept for smaller result sets that need paging.
   */
  async queryActiveContractsPaginated({ party, templateIds = [], activeAtOffset = null, verbose = false }, token) {
    const allContracts = [];
    let pageToken = null;
    const pageSize = 50; // Small page size
    let iterations = 0;
    const maxIterations = 10; // Safety limit
    
    // If activeAtOffset not provided, fetch from ledger-end (required field)
    let effectiveOffset = activeAtOffset;
    if (effectiveOffset === null || effectiveOffset === undefined) {
      try {
        effectiveOffset = await this.getLedgerEndOffset(token);
        console.log(`[CantonService] Paginated query using ledger-end offset: ${effectiveOffset}`);
      } catch (error) {
        console.warn(`[CantonService] Failed to get ledger-end for pagination, using 0:`, error.message);
        effectiveOffset = '0';
      }
    }
    
    // Ensure offset is a string (Canton API requires string)
    if (typeof effectiveOffset === 'number') {
      effectiveOffset = effectiveOffset.toString();
    }
    
    do {
      const url = `${this.jsonApiBase}/v2/state/active-contracts`;
      
      const filter = {};
      if (party) {
        // Separate interfaces from templates
        // Interfaces start with "#" prefix
        const allIds = [...interfaceIds, ...templateIds];
        const interfaces = allIds.filter(t => typeof t === 'string' && t.startsWith('#'));
        const templates = allIds.filter(t => !(typeof t === 'string' && t.startsWith('#')));
        
        console.log(`[CantonService] Separated: ${interfaces.length} interfaces, ${templates.length} templates`);
        if (interfaces.length > 0) {
          console.log(`[CantonService] Interface IDs:`, interfaces);
        }
        
        const filters = [];
        
        // Add interface filters FIRST (per client instructions)
        if (interfaces.length > 0) {
          filters.push(...interfaces.map(interfaceId => {
            console.log(`[CantonService] Adding InterfaceFilter for: ${interfaceId}`);
            return {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: interfaceId, // Keep as string with # prefix
                    includeCreatedEventBlob: true,
                    includeInterfaceView: true
                  }
                }
              }
            };
          }));
        }
        
        // Add template filters
        if (templates.length > 0) {
          filters.push(...templates.map(t => {
            const normalized = normalizeTemplateId(t);
            return {
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: normalized,
                    includeCreatedEventBlob: false
                  }
                }
              }
            };
          }));
        }
        
        filter.filtersByParty = {
          [party]: filters.length > 0 ? {
            cumulative: filters
          } : {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } }
              }
            }]
          }
        };
      } else {
        // Separate interfaces from templates for filtersForAnyParty
        const interfaces = [...interfaceIds, ...templateIds.filter(t => typeof t === 'string' && t.startsWith('#'))];
        const templates = templateIds.filter(t => !(typeof t === 'string' && t.startsWith('#')));
        
        const filters = [];
        
        // Add interface filters
        if (interfaces.length > 0) {
          filters.push(...interfaces.map(interfaceId => ({
            identifierFilter: {
              InterfaceFilter: {
                value: {
                  interfaceId: interfaceId,
                  includeCreatedEventBlob: true,
                  includeInterfaceView: true
                }
              }
            }
          })));
        }
        
        // Add template filters
        if (templates.length > 0) {
          filters.push(...templates.map(t => {
            const normalized = normalizeTemplateId(t);
            return {
            identifierFilter: {
              TemplateFilter: {
                value: {
                    templateId: normalized,
                  includeCreatedEventBlob: false
                }
              }
            }
            };
          }));
        }
        
        filter.filtersForAnyParty = filters.length > 0 ? {
          cumulative: filters
        } : {
          cumulative: [{
            identifierFilter: {
              WildcardFilter: { value: { includeCreatedEventBlob: false } }
            }
          }]
        };
      }

      const body = {
        filter,
        verbose,
        activeAtOffset: effectiveOffset,
        pageSize,
      };
      
      if (pageToken) {
        body.pageToken = pageToken;
      }

      // Log request body for debugging (especially for InterfaceFilter)
      if (templateIds.some(t => typeof t === 'string' && t.startsWith('#')) || interfaceIds.length > 0) {
        console.log(`[CantonService] 🔍 Request body (InterfaceFilter):`);
        console.log(JSON.stringify(body, null, 2));
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      let result;
      if (!res.ok) {
        const errorText = await res.text();
        // Check for 200 element limit - try to parse response anyway, might have pageToken
        if (errorText.includes('JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED')) {
          console.log(`[CantonService] ℹ️ 200+ contracts found. Attempting to continue pagination...`);
          try {
            result = JSON.parse(errorText);
            // If we got contracts and a pageToken, continue
            if (result.activeContracts && result.nextPageToken) {
              pageToken = result.nextPageToken;
              // Process the contracts we got
              const rawContracts = result.activeContracts || [];
              const contracts = rawContracts.map(item => {
                if (item.contractEntry?.JsActiveContract) {
                  const activeContract = item.contractEntry.JsActiveContract;
                  const createdEvent = activeContract.createdEvent || {};
                  return {
                    contractId: createdEvent.contractId,
                    templateId: createdEvent.templateId,
                    payload: createdEvent.createArgument,
                    createArgument: createdEvent.createArgument,
                    signatories: createdEvent.signatories,
                    observers: createdEvent.observers,
                    witnessParties: createdEvent.witnessParties,
                    offset: createdEvent.offset,
                    synchronizerId: activeContract.synchronizerId,
                    createdAt: createdEvent.createdAt,
                    createdEvent: createdEvent
                  };
                }
                return item;
              });
              allContracts.push(...contracts);
              iterations++;
              continue; // Continue to next iteration with pageToken
            }
          } catch (parseErr) {
            // Can't parse, return what we have
            console.log(`[CantonService] Cannot parse error response, returning ${allContracts.length} contracts`);
            return allContracts;
          }
        }
        console.error(`[CantonService] Paginated query failed:`, errorText);
        break;
      }

      result = await res.json();
      const rawContracts = result.activeContracts || result || [];
      
      // Normalize Canton JSON API v2 response format (same as regular query)
      const contracts = rawContracts.map(item => {
        if (item.contractEntry?.JsActiveContract) {
          const activeContract = item.contractEntry.JsActiveContract;
          const createdEvent = activeContract.createdEvent || {};
          return {
            contractId: createdEvent.contractId,
            templateId: createdEvent.templateId,
            payload: createdEvent.createArgument, // The actual contract data
            createArgument: createdEvent.createArgument,
            signatories: createdEvent.signatories,
            observers: createdEvent.observers,
            witnessParties: createdEvent.witnessParties,
            offset: createdEvent.offset,
            synchronizerId: activeContract.synchronizerId,
            createdAt: createdEvent.createdAt,
            // Add createdEvent for compatibility
            createdEvent: createdEvent
          };
        }
        // Fallback for other response formats
        return item;
      });
      
      allContracts.push(...contracts);
      
      // Check for next page token
      pageToken = result.nextPageToken || null;
      iterations++;
      
      console.log(`[CantonService] Paginated query: got ${contracts.length} contracts (total: ${allContracts.length}), hasMore: ${!!pageToken}`);
      
    } while (pageToken && iterations < maxIterations);
    
    console.log(`[CantonService] ✅ Paginated query complete: ${allContracts.length} total contracts`);
    
    console.log(`[CantonService] ✅ Paginated query complete: ${allContracts.length} total contracts`);
    return allContracts;
  }

  /**
   * Stream active contracts via WebSocket (recommended for 200+ contracts)
   * Uses ws://host/v2/state/active-contracts WebSocket endpoint
   * 
   * Per Canton team: "You can use either ledger-api or websockets for streaming active contracts"
   */
  async streamActiveContracts({ party, templateIds = [], activeAtOffset = null, verbose = true }, token) {
    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      
      // Convert HTTP URL to WebSocket URL
      const wsUrl = this.jsonApiBase.replace(/^http/, 'ws') + '/v2/state/active-contracts';
      
      // Get ledger-end offset if not provided
      let effectiveOffset = activeAtOffset;
      if (!effectiveOffset) {
        this.getLedgerEndOffset(token).then(offset => {
          effectiveOffset = offset;
          startStream();
        }).catch(reject);
      } else {
        startStream();
      }
      
      function startStream() {
        // WebSocket authentication: Use subprotocol jwt.token.{JWT_TOKEN}
        // Per Canton AsyncAPI spec: Sec-WebSocket-Protocol: jwt.token.{token}
        let ws;
        try {
          const wsProtocol = `jwt.token.${token}`;
          ws = new WebSocket(wsUrl, [wsProtocol]);
        } catch (err) {
          // If subprotocol fails, try without (some servers don't require it)
          console.log(`[CantonService] WebSocket subprotocol failed, trying without...`);
          ws = new WebSocket(wsUrl);
        }
        
        const allContracts = [];
        let requestSent = false;
        let timeoutId = null;
        
        // Build filter and request outside handlers so they're accessible everywhere
        const filter = {};
        if (party) {
          filter.filtersByParty = {
            [party]: templateIds.length > 0 ? {
              cumulative: templateIds.map(t => {
                const templateIdStr = typeof t === 'string' ? t : `${t.packageId}:${t.moduleName}:${t.entityName}`;
                // If starts with "#", it's an INTERFACE, use InterfaceFilter
                if (templateIdStr.startsWith("#")) {
                  return {
                    identifierFilter: {
                      InterfaceFilter: {
                        value: {
                          interfaceId: templateIdStr,
                          includeCreatedEventBlob: true,
                          includeInterfaceView: true
                        }
                      }
                    }
                  };
                }
                // Regular template - use TemplateFilter
                return {
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId: templateIdStr,
                        includeCreatedEventBlob: false
                      }
                    }
                  }
                };
              })
            } : {
              cumulative: [{
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } }
                }
              }]
            }
          };
        }
        
        const request = {
          filter,
          verbose,
          activeAtOffset: typeof effectiveOffset === 'number' ? effectiveOffset.toString() : effectiveOffset
        };
        
        ws.on('open', () => {
          console.log(`[CantonService] WebSocket connected for active contracts stream`);
          ws.send(JSON.stringify(request));
          requestSent = true;
        });
        
        let messageCount = 0;
        let lastMessageTime = Date.now();
        
        ws.on('message', (data) => {
          try {
            messageCount++;
            lastMessageTime = Date.now();
            const message = JSON.parse(data.toString());
            
            // Handle error response
            if (message.code) {
              console.error(`[CantonService] WebSocket error response:`, message);
              ws.close();
              reject(new Error(message.message || message.cause || 'WebSocket error'));
              return;
            }
            
            // Handle contract entry - check all possible response formats
            const contractEntry = message.contractEntry || message;
            
            if (contractEntry.JsActiveContract) {
              const activeContract = contractEntry.JsActiveContract;
              const createdEvent = activeContract.createdEvent || {};
              allContracts.push({
                contractId: createdEvent.contractId,
                templateId: createdEvent.templateId,
                payload: createdEvent.createArgument,
                createArgument: createdEvent.createArgument,
                signatories: createdEvent.signatories,
                observers: createdEvent.observers,
                witnessParties: createdEvent.witnessParties,
                offset: createdEvent.offset,
                synchronizerId: activeContract.synchronizerId,
                createdAt: createdEvent.createdAt,
                createdEvent: createdEvent
              });
              
              if (messageCount % 50 === 0) {
                console.log(`[CantonService] WebSocket: received ${messageCount} messages, ${allContracts.length} contracts so far`);
              }
            }
            
            // Check for end marker (JsEmpty, JsIncompleteAssigned, JsIncompleteUnassigned)
            if (contractEntry.JsEmpty || contractEntry.JsIncompleteAssigned || contractEntry.JsIncompleteUnassigned) {
              console.log(`[CantonService] ✅ WebSocket stream end marker received: ${allContracts.length} contracts`);
              ws.close();
              resolve(allContracts);
              return;
            }
          } catch (err) {
            console.error(`[CantonService] WebSocket message parse error:`, err.message);
            console.error(`[CantonService] Raw message:`, data.toString().substring(0, 200));
          }
        });
        
        // Timeout after 60 seconds (longer for large streams)
        timeoutId = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
            console.log(`[CantonService] WebSocket timeout after 60s: ${allContracts.length} contracts received`);
            ws.close();
            if (allContracts.length > 0) {
              resolve(allContracts);
            } else {
              reject(new Error('WebSocket stream timeout - no contracts received'));
            }
          }
        }, 60000);
        
        ws.on('error', (error) => {
          // If subprotocol error, try without subprotocol
          if (error.message && error.message.includes('subprotocol')) {
            console.log(`[CantonService] WebSocket subprotocol error, retrying without subprotocol...`);
            clearTimeout(timeoutId);
            // Retry without subprotocol (might work if server doesn't require it)
            const wsRetry = new WebSocket(wsUrl);
            setupWebSocketHandlers(wsRetry, request, resolve, reject);
            return;
          }
          console.error(`[CantonService] WebSocket connection error:`, error.message);
          clearTimeout(timeoutId);
          reject(error);
        });
        
        // Helper function to setup handlers (for retry)
        function setupWebSocketHandlers(wsInstance, requestObj, resolveFn, rejectFn) {
          const allContractsRetry = [];
          let requestSentRetry = false;
          let timeoutIdRetry = null;
          
          wsInstance.on('open', () => {
            wsInstance.send(JSON.stringify(requestObj));
            requestSentRetry = true;
          });
          
          wsInstance.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.contractEntry?.JsActiveContract) {
                const activeContract = message.contractEntry.JsActiveContract;
                const createdEvent = activeContract.createdEvent || {};
                allContractsRetry.push({
                  contractId: createdEvent.contractId,
                  templateId: createdEvent.templateId,
                  payload: createdEvent.createArgument,
                  createArgument: createdEvent.createArgument,
                  createdEvent: createdEvent
                });
              }
              if (message.contractEntry?.JsEmpty) {
                wsInstance.close();
                resolveFn(allContractsRetry);
              }
            } catch (err) {
              // Ignore parse errors
            }
          });
          
          wsInstance.on('close', () => {
            if (requestSentRetry && allContractsRetry.length > 0) {
              resolveFn(allContractsRetry);
            }
          });
          
          timeoutIdRetry = setTimeout(() => {
            wsInstance.close();
            if (allContractsRetry.length > 0) {
              resolveFn(allContractsRetry);
            } else {
              rejectFn(new Error('WebSocket timeout'));
            }
          }, 60000);
        }
        
        ws.on('close', (code, reason) => {
          clearTimeout(timeoutId);
          console.log(`[CantonService] WebSocket closed: code=${code}, reason=${reason?.toString() || 'none'}, contracts=${allContracts.length}`);
          if (requestSent) {
            if (allContracts.length > 0) {
              resolve(allContracts);
            } else if (code === 1000) {
              // Normal closure - stream completed (even if empty)
              resolve(allContracts);
            } else {
              reject(new Error(`WebSocket closed unexpectedly: code=${code}`));
            }
          } else {
            reject(new Error('WebSocket closed before request sent'));
          }
        });
      }
    });
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