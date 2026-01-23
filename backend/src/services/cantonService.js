/**
 * Canton Service - JSON Ledger API v2
 */
const config = require("../config");
const CantonAdmin = require("./canton-admin");
const crypto = require("crypto");

function normalizeTemplateId(templateId) {
  // v2 expects templateId as STRING.
  // Use package-id reference: "<packageId>:<Module>:<Entity>"
  if (templateId && typeof templateId === "object" && templateId.packageId) {
    return `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;
  }
  return templateId;
}

class CantonService {
  constructor(cantonApiBase) {
    this.cantonApiBase = cantonApiBase || config.canton.jsonApiBase;
    this.operatorPartyId = config.canton.operatorPartyId;
  }

  async submitAndWait(token, body) {
    const res = await fetch(`${this.cantonApiBase}/v2/commands/submit-and-wait`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`submit-and-wait failed ${res.status}: ${text}`);
    return JSON.parse(text);
  }

  // ✅ Correct v2 envelope: commandId/actAs/... at TOP LEVEL
  async createContract({ token, actAsParty, templateId, createArguments, readAs, userId, synchronizerId }) {
    if (!actAsParty) throw new Error("createContract: actAsParty is required");
    if (!templateId) throw new Error("createContract: templateId is required");
    if (!createArguments) throw new Error("createContract: createArguments is required");

    const templateIdStr = normalizeTemplateId(templateId);

    const body = {
      commandId: crypto.randomUUID(),
      actAs: [actAsParty],
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

  async exerciseChoice({ token, actAsParty, templateId, contractId, choice, choiceArgument, readAs, userId, synchronizerId }) {
    if (!actAsParty) throw new Error("exerciseChoice: actAsParty is required");
    if (!templateId) throw new Error("exerciseChoice: templateId is required");
    if (!contractId) throw new Error("exerciseChoice: contractId is required");
    if (!choice) throw new Error("exerciseChoice: choice is required");

    const templateIdStr = normalizeTemplateId(templateId);

    const body = {
      commandId: crypto.randomUUID(),
      actAs: [actAsParty],
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
    const cantonAdmin = new CantonAdmin();
    return cantonAdmin.getAdminToken();
  }

  async discoverPackages(adminToken) {
    const response = await fetch(`${this.cantonApiBase}/v2/packages`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok) return null;
    return response.json();
  }
}

module.exports = new CantonService(config.canton.jsonApiBase);
