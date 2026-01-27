/**
 * Canton Service - JSON Ledger API v2
 */
const config = require("../config");
const CantonAdmin = require("./canton-admin");
const CantonGrpcClient = require("./canton-grpc-client");
const crypto = require("crypto");

function normalizeTemplateId(templateId) {
  // v2 expects templateId as STRING.
  // Use package-id reference: "<packageId>:<Module>:<Entity>"
  if (templateId && typeof templateId === "object" && templateId.packageId) {
    return `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;
  }
  return templateId;
}

function decodeTokenPayload(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token is required to extract payload");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
  const payloadJson = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(payloadJson);
}

class CantonService {
  constructor(cantonApiBase) {
    this.cantonApiBase = cantonApiBase || config.canton.jsonApiBase;
    this.operatorPartyId = config.canton.operatorPartyId;
    this.cantonAdmin = new CantonAdmin();
  }

  async submitAndWaitForTransaction(token, body) {
    const res = await fetch(
      `${this.cantonApiBase}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      // Parse error response for better error messages
      let errorMessage = `submit-and-wait-for-transaction failed ${res.status}: ${text}`;
      try {
        const errorData = JSON.parse(text);
        if (errorData.code === "JSON_API_PACKAGE_SELECTION_FAILED") {
          errorMessage =
            `Package vetting error: ${errorData.cause || errorData.message || text}\n` +
            `This usually means the package is not vetted on all hosting participants. ` +
            `Ensure the DAR is uploaded and vetted on all participants that host the parties involved.`;
        } else if (errorData.code) {
          errorMessage = `${errorData.code}: ${errorData.cause || errorData.message || text}`;
        }
      } catch (e) {
        // If parsing fails, use original text
      }
      throw new Error(errorMessage);
    }

    const result = JSON.parse(text);
    return result;
  }

  async submitAndWait(token, body) {
    const res = await fetch(
      `${this.cantonApiBase}/v2/commands/submit-and-wait`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      let errorMessage = `submit-and-wait failed ${res.status}: ${text}`;
      try {
        const errorData = JSON.parse(text);
        if (errorData.code === "JSON_API_PACKAGE_SELECTION_FAILED") {
          errorMessage =
            `Package vetting error: ${errorData.cause || errorData.message || text}\n` +
            `This usually means the package is not vetted on all hosting participants. ` +
            `Ensure the DAR is uploaded and vetted on all participants that host the parties involved.`;
        } else if (errorData.code) {
          errorMessage = `${errorData.code}: ${errorData.cause || errorData.message || text}`;
        }
      } catch (e) {
        // ignore
      }
      throw new Error(errorMessage);
    }

    const result = JSON.parse(text);

    // If we got updateId, immediately query transaction for real contract ID
    if (result.updateId) {
      try {
        const txRes = await fetch(
          `${this.cantonApiBase}/v2/updates/update-by-id`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              updateId: result.updateId,
              updateFormat: "verbose",
              includeTransactions: true,
            }),
          },
        );

        if (txRes.ok) {
          const txData = await txRes.json();
          if (txData.transactions && Array.isArray(txData.transactions)) {
            for (const tx of txData.transactions) {
              if (tx.events && Array.isArray(tx.events)) {
                for (const event of tx.events) {
                  if (event.created?.contractId) {
                    return {
                      ...result,
                      transaction: {
                        events: [event],
                      },
                    };
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.log("[CantonService] Could not query transaction:", e.message);
      }
    }

    // Fallback: return whatever we got
    return result;
  }

  // ✅ Correct v2 envelope: commandId/actAs/... at TOP LEVEL
  async createContractWithTransaction({
    token,
    actAsParty,
    templateId,
    createArguments,
    readAs,
    userId,
    synchronizerId,
  }) {
    const actAsParties = Array.isArray(actAsParty) ? actAsParty : [actAsParty];
    if (!actAsParties.length || !actAsParties[0])
      throw new Error("createContract: actAsParty is required");
    if (!templateId) throw new Error("createContract: templateId is required");
    if (!createArguments)
      throw new Error("createContract: createArguments is required");

    const templateIdStr = normalizeTemplateId(templateId);

    const body = {
      commandId: crypto.randomUUID(),
      actAs: actAsParties,
      ...(Array.isArray(readAs) && readAs.length ? { readAs } : {}),
      ...(userId ? { userId } : {}),
      ...(synchronizerId ? { synchronizerId } : {}),
      commands: [
        {
          CreateCommand: {
            templateId: templateIdStr,
            createArguments,
          },
        },
      ],
    };

    return this.submitAndWaitForTransaction(token, body);
  }

  async createContract({
    token,
    actAsParty,
    templateId,
    createArguments,
    readAs,
    userId,
    synchronizerId,
  }) {
    const actAsParties = Array.isArray(actAsParty) ? actAsParty : [actAsParty];
    if (!actAsParties.length || !actAsParties[0])
      throw new Error("createContract: actAsParty is required");
    if (!templateId) throw new Error("createContract: templateId is required");
    if (!createArguments)
      throw new Error("createContract: createArguments is required");

    const templateIdStr = normalizeTemplateId(templateId);

    const body = {
      commandId: crypto.randomUUID(),
      actAs: actAsParties,
      ...(Array.isArray(readAs) && readAs.length ? { readAs } : {}),
      ...(userId ? { userId } : {}),
      ...(synchronizerId ? { synchronizerId } : {}),
      commands: [
        {
          CreateCommand: {
            templateId: templateIdStr,
            createArguments,
          },
        },
      ],
    };

    return this.submitAndWait(token, body);
  }

  async exerciseChoice({
    token,
    actAsParty,
    templateId,
    contractId,
    choice,
    choiceArgument,
    readAs,
    userId,
    synchronizerId,
  }) {
    const actAsParties = Array.isArray(actAsParty) ? actAsParty : [actAsParty];
    if (!actAsParties.length || !actAsParties[0]) {
      throw new Error("exerciseChoice: actAsParty is required");
    }
    if (!templateId) throw new Error("exerciseChoice: templateId is required");
    if (!contractId) throw new Error("exerciseChoice: contractId is required");
    if (!choice) throw new Error("exerciseChoice: choice is required");

    const templateIdStr = normalizeTemplateId(templateId);

    const body = {
      commandId: crypto.randomUUID(),
      actAs: actAsParties,
      ...(Array.isArray(readAs) && readAs.length ? { readAs } : {}),
      ...(userId ? { userId } : {}),
      ...(synchronizerId ? { synchronizerId } : {}),
      commands: [
        {
          ExerciseCommand: {
            templateId: templateIdStr,
            contractId,
            choice,
            choiceArgument: choiceArgument ?? {},
          },
        },
      ],
    };

    return this.submitAndWait(token, body);
  }

  async getAdminToken() {
    return this.cantonAdmin.getAdminToken();
  }

  async ensurePartyRights(partyId, adminToken) {
    if (!partyId) {
      throw new Error("ensurePartyRights: partyId is required");
    }

    const token = adminToken || (await this.getAdminToken());
    const payload = decodeTokenPayload(token);
    const userId = payload?.sub;
    if (!userId) {
      throw new Error("Token missing sub claim");
    }

    const damlClaim =
      payload["https://daml.com/ledgerapi"] ||
      payload["https://daml.com/ledger-api"];
    const actAs = Array.isArray(damlClaim?.actAs)
      ? damlClaim.actAs
      : Array.isArray(payload.actAs)
        ? payload.actAs
        : [];
    const readAs = Array.isArray(damlClaim?.readAs)
      ? damlClaim.readAs
      : Array.isArray(payload.readAs)
        ? payload.readAs
        : [];
    if (actAs.includes(partyId) && readAs.includes(partyId)) {
      return { ensured: false, alreadyGranted: true, source: "token-claim" };
    }
    const grpcClient = new CantonGrpcClient();

    let rights = [];
    try {
      const rightsResponse = await grpcClient.listUserRights(userId, token);
      rights = Array.isArray(rightsResponse?.rights)
        ? rightsResponse.rights
        : [];
    } catch (error) {
      console.warn(
        "[CantonService] Could not list user rights, will try to grant:",
        error.message,
      );
    }

    const hasActAs = rights.some(
      (right) => right?.can_act_as?.party === partyId,
    );
    const hasReadAs = rights.some(
      (right) => right?.can_read_as?.party === partyId,
    );
    if (hasActAs && hasReadAs) {
      return { ensured: false, alreadyGranted: true };
    }

    try {
      await grpcClient.grantUserRights(userId, partyId, token);
      return { ensured: true, alreadyGranted: false };
    } catch (error) {
      const message = String(error.message || "");
      if (
        message.includes("ALREADY_EXISTS") ||
        message.includes("AlreadyExists") ||
        message.includes("(6)")
      ) {
        return { ensured: false, alreadyGranted: true };
      }
      throw error;
    }
  }

  async fetchContract(contractId, adminToken, readAs) {
    if (!contractId) {
      throw new Error("fetchContract: contractId is required");
    }

    const token = adminToken || (await this.getAdminToken());
    const body = { contractId };
    if (Array.isArray(readAs) && readAs.length > 0) {
      body.readAs = readAs;
    }

    const response = await fetch(`${this.cantonApiBase}/v2/contracts/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch contract: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    return {
      contractId: data.contractId || contractId,
      payload: data.payload || data.argument || data.createArgument || data,
    };
  }

  async discoverPackages(adminToken) {
    const response = await fetch(`${this.cantonApiBase}/v2/packages`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok) return null;
    return response.json();
  }

  /**
   * Get package ID for a specific template
   * Tries config first, then discovers from API
   * @param {string} templateName - Template name (e.g., "UserAccount", "MasterOrderBook")
   * @param {string} adminToken - Admin token for API access
   * @returns {Promise<string>} Package ID
   */
  async getPackageIdForTemplate(templateName, adminToken) {
    // First, try to get from config
    const configPackageIds = config.canton.packageIds || {};

    // Map template names to config keys
    const templateToConfigKey = {
      UserAccount: "userAccount",
      MasterOrderBook: "masterOrderBook",
      // Prefer the main CLOB package for OrderBook; fall back to legacy if needed.
      OrderBook: "clobExchange",
      AssetHolding: "clobExchange",
      Faucet: "clobExchange",
    };

    const configKey = templateToConfigKey[templateName];
    if (configKey && configPackageIds[configKey]) {
      console.log(
        `[CantonService] Using package ID from config for ${templateName}: ${configPackageIds[configKey].substring(0, 16)}...`,
      );
      return configPackageIds[configKey];
    }
    if (templateName === "OrderBook" && configPackageIds.masterOrderBook) {
      console.warn(
        "[CantonService] Falling back to masterOrderBook package ID for OrderBook",
      );
      return configPackageIds.masterOrderBook;
    }

    // Fallback: try to discover from API
    console.log(
      `[CantonService] Discovering package ID for ${templateName} from API...`,
    );
    try {
      const packagesData = await this.discoverPackages(adminToken);
      if (
        packagesData &&
        packagesData.packageIds &&
        packagesData.packageIds.length > 0
      ) {
        // Use the most recent package (last in array)
        const packageId =
          packagesData.packageIds[packagesData.packageIds.length - 1];
        console.log(
          `[CantonService] Discovered package ID: ${packageId.substring(0, 16)}...`,
        );
        return packageId;
      }
    } catch (error) {
      console.warn(
        `[CantonService] Failed to discover package ID: ${error.message}`,
      );
    }

    // Last resort: use clobExchange as fallback
    if (configPackageIds.clobExchange) {
      console.warn(
        `[CantonService] Using clobExchange package ID as fallback for ${templateName}`,
      );
      return configPackageIds.clobExchange;
    }

    throw new Error(
      `Could not determine package ID for template ${templateName}. Please configure it in config.canton.packageIds.`,
    );
  }

  /**
   * Verify package status on the ledger
   * @param {string} packageId - Package ID to verify
   * @param {string} adminToken - Admin token for API access
   * @returns {Promise<object>} Package status information
   */
  async verifyPackageStatus(packageId, adminToken) {
    try {
      const packagesData = await this.discoverPackages(adminToken);
      if (packagesData && packagesData.packageIds) {
        const isRegistered = packagesData.packageIds.includes(packageId);
        return {
          packageId,
          isRegistered,
          totalPackages: packagesData.packageIds.length,
        };
      }
      return {
        packageId,
        isRegistered: false,
        error: "Could not fetch packages list",
      };
    } catch (error) {
      return { packageId, isRegistered: false, error: error.message };
    }
  }

  /**
   * Get ledger end offset from Canton
   * @param {string} adminToken - Admin token for API access
   * @returns {Promise<string|null>} Ledger end offset or null if unavailable
   */
  async getLedgerEndOffset(adminToken) {
    try {
      const response = await fetch(
        `${this.cantonApiBase}/v2/state/ledger-end`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        return data.offset || data.ledgerEnd || null;
      }
      console.warn(
        "[CantonService] Failed to get ledger end:",
        response.status,
      );
      return null;
    } catch (error) {
      console.warn(
        "[CantonService] Error getting ledger end offset:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Get active at offset for queries
   * Uses ledger end offset if available, otherwise defaults to '0' (current ledger end)
   * @param {string} adminToken - Admin token for API access
   * @param {string|number|null} completionOffset - Optional specific offset to use
   * @returns {Promise<string>} Active at offset as string
   */
  async getActiveAtOffset(adminToken, completionOffset = null) {
    if (completionOffset !== null && completionOffset !== undefined) {
      return completionOffset.toString();
    }

    // Try to get ledger end offset
    const ledgerEnd = await this.getLedgerEndOffset(adminToken);
    if (ledgerEnd) {
      return ledgerEnd.toString();
    }

    // Default to '0' which means "current ledger end" in Canton JSON API v2
    return "0";
  }

  /**
   * Query active contracts by template
   * @param {object} options - Query options
   * @param {string} options.templateId - Template ID (e.g., "UserAccount:UserAccount" or "AssetHolding:AssetHolding")
   * @param {object} options.filter - Optional filter object (for backward compatibility)
   * @param {string} options.party - Party ID to query for (defaults to operator party)
   * @param {string} adminToken - Admin token for API access
   * @returns {Promise<Array>} Array of active contracts
   */
  async queryContracts({ templateId, filter, party }, adminToken) {
    if (!adminToken) {
      adminToken = await this.getAdminToken();
    }

    // Use provided party or default to operator party
    const queryParty = party || this.operatorPartyId;

    // Get package ID for template if needed (if templateId is unqualified)
    let qualifiedTemplateId = templateId;
    if (!templateId.includes(":")) {
      // Unqualified template ID, try to qualify it
      try {
        const packageId = await this.getPackageIdForTemplate(
          templateId.split(":")[0] || templateId,
          adminToken,
        );
        qualifiedTemplateId = `${packageId}:${templateId}`;
      } catch (error) {
        console.warn(
          `[CantonService] Could not qualify template ID ${templateId}, using as-is`,
        );
      }
    }

    // Get active at offset
    const activeAtOffset = await this.getActiveAtOffset(adminToken);

    const response = await fetch(
      `${this.cantonApiBase}/v2/state/active-contracts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          readAs: [queryParty],
          activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [queryParty]: {
                inclusive: {
                  templateIds: [qualifiedTemplateId],
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to query contracts: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    // Parse contracts to extract payload
    return contracts.map((contract) => {
      const contractData =
        contract.contractEntry?.JsActiveContract?.createdEvent ||
        contract.createdEvent ||
        contract;

      return {
        contractId: contractData.contractId || contract.contractId,
        payload:
          contractData.createArgument ||
          contractData.argument ||
          contract.payload ||
          contractData,
        createdAt: contractData.createdAt || contract.createdAt,
      };
    });
  }
}

module.exports = new CantonService(config.canton.jsonApiBase);
