/**
 * Ledger Proxy Controller (BFF)
 *
 * Rules:
 * - Frontend never calls Canton JSON API directly.
 * - Frontend never stores Canton JWTs.
 * - Backend uses client_credentials (OnboardingService.getCantonToken()).
 * - PartyId is derived from in-memory user mapping (x-user-id header).
 */

const config = require('../config');
const OnboardingService = require('../services/onboarding-service');
const cantonService = require('../services/cantonService');
const { requirePartyId, requirePublicKey } = require('../state/userRegistry');

const ed25519 = require('@noble/ed25519');
const { sha512 } = require('@noble/hashes/sha512');

// Ensure noble has sha512Sync set (works in both node + browser builds)
if (!ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));
}

// In-memory challenge store: userId -> { challenge, expiresAt }
const challengeStore = new Map();

function toBytesUtf8(str) {
  return new TextEncoder().encode(str);
}

function isUnauthorizedError(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return msg.includes(' 401 ') || msg.includes('401 -') || msg.includes('401:') || msg.includes('Failed to') && msg.includes('401');
}

async function qualifyTemplateId(templateId, token) {
  // Already qualified: "<packageId>:Module:Entity"
  // packageId is typically 64 hex chars
  if (/^[0-9a-f]{32,}:/i.test(templateId)) return templateId;

  // Unqualified common form: "Module:Entity"
  const templateName = templateId.split(':')[0] || templateId;
  try {
    const pkg = await cantonService.getPackageIdForTemplate(templateName, token);
    return `${pkg}:${templateId}`;
  } catch (e) {
    // Fall back to as-is; Canton may still accept if server has default package selection.
    return templateId;
  }
}

class LedgerProxyController {
  constructor() {
    this.onboardingService = new OnboardingService();
  }

  issueChallenge(req, res) {
    const userId = req.userId;
    const challenge = `clob:${userId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
    challengeStore.set(userId, { challenge, expiresAt });
    res.json({ challenge, expiresAt });
  }

  async verifyChallengeSignatureOrThrow(userId, challenge, signatureBase64) {
    const stored = challengeStore.get(userId);
    if (!stored || !stored.challenge) {
      const err = new Error('Missing server challenge. Call GET /api/ledger/challenge first.');
      err.statusCode = 401;
      throw err;
    }
    if (Date.now() > stored.expiresAt) {
      challengeStore.delete(userId);
      const err = new Error('Challenge expired. Please retry.');
      err.statusCode = 401;
      throw err;
    }
    if (stored.challenge !== challenge) {
      const err = new Error('Challenge mismatch.');
      err.statusCode = 401;
      throw err;
    }

    const publicKeyBase64 = requirePublicKey(userId);
    const publicKeyBytes = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));
    const sigBytes = new Uint8Array(Buffer.from(signatureBase64, 'base64'));
    const msgBytes = toBytesUtf8(challenge);

    const ok = await ed25519.verify(sigBytes, msgBytes, publicKeyBytes);
    if (!ok) {
      const err = new Error('Invalid wallet signature.');
      err.statusCode = 401;
      throw err;
    }

    // One-time use
    challengeStore.delete(userId);
  }

  async withCantonTokenRetry(fn) {
    let token = await this.onboardingService.getCantonToken();
    try {
      return await fn(token);
    } catch (err) {
      if (!isUnauthorizedError(err)) throw err;
      // force refresh and retry once
      this.onboardingService.cachedToken = null;
      this.onboardingService.tokenExpiry = null;
      token = await this.onboardingService.getCantonToken();
      return await fn(token);
    }
  }

  /**
   * POST /api/ledger/query-active-contracts
   * body: { templateId, offset? }
   */
  queryActiveContracts = async (req, res) => {
    const userId = req.userId;
    const templateId = req.body?.templateId;
    const limitInput = req.body?.limit;
    if (!templateId || typeof templateId !== 'string') {
      return res.status(400).json({ error: 'templateId is required (string)' });
    }

    const partyId = requirePartyId(userId);
    const completionOffset = req.body?.offset ?? null;
    const limit = Number.isFinite(Number(limitInput))
      ? Math.min(Math.max(Number(limitInput), 1), 200)
      : Math.min(Math.max(Number(config.api.batchSize || 200), 1), 200);

    const result = await this.withCantonTokenRetry(async (token) => {
      const qualified = await qualifyTemplateId(templateId, token);
      const activeAtOffset = await cantonService.getActiveAtOffset(token, completionOffset);

      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=${limit}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          readAs: [partyId],
          activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [partyId]: {
                inclusive: {
                  templateIds: [qualified],
                },
              },
            },
          },
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Failed to query contracts: ${response.status} - ${text}`);
      }
      const data = JSON.parse(text);
      const contracts = data.activeContracts || [];
      return contracts.map((entry) => {
        const c = entry.contractEntry?.JsActiveContract?.createdEvent || entry.createdEvent || entry;
        return {
          contractId: c.contractId || entry.contractId,
          templateId: c.templateId || entry.templateId,
          payload: c.createArgument || c.argument || c.payload || entry.argument,
          createdAt: c.createdAt || entry.createdAt,
        };
      });
    });

    res.json({ partyId, templateId, contracts: result });
  };

  /**
   * POST /api/ledger/fetch-contract
   * body: { contractId, offset? }
   */
  fetchContract = async (req, res) => {
    const userId = req.userId;
    const { contractId, offset } = req.body || {};
    if (!contractId || typeof contractId !== 'string') {
      return res.status(400).json({ error: 'contractId is required (string)' });
    }
    const partyId = requirePartyId(userId);

    const contract = await this.withCantonTokenRetry(async (token) => {
      const activeAtOffset = await cantonService.getActiveAtOffset(token, offset ?? null);
      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=10`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          readAs: [partyId],
          activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [partyId]: {
                inclusive: {
                  contractIds: [contractId],
                },
              },
            },
          },
        }),
      });

      const text = await response.text();
      if (!response.ok) throw new Error(`Failed to fetch contract: ${response.status} - ${text}`);
      const data = JSON.parse(text);
      const entries = data.activeContracts || [];
      if (entries.length === 0) return null;
      const c = entries[0].contractEntry?.JsActiveContract?.createdEvent || entries[0].createdEvent || entries[0];
      return {
        contractId: c.contractId || contractId,
        templateId: c.templateId,
        payload: c.createArgument || c.argument || c.payload,
        createdAt: c.createdAt,
      };
    });

    res.json({ contract });
  };

  /**
   * POST /api/ledger/fetch-contracts
   * body: { contractIds: string[], offset? }
   */
  fetchContracts = async (req, res) => {
    const userId = req.userId;
    const { contractIds, offset } = req.body || {};
    if (!Array.isArray(contractIds) || contractIds.length === 0) {
      return res.status(400).json({ error: 'contractIds is required (non-empty array)' });
    }
    const partyId = requirePartyId(userId);

    const contracts = await this.withCantonTokenRetry(async (token) => {
      const activeAtOffset = await cantonService.getActiveAtOffset(token, offset ?? null);
      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts?limit=200`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          readAs: [partyId],
          activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [partyId]: {
                inclusive: {
                  contractIds,
                },
              },
            },
          },
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Failed to fetch contracts: ${response.status} - ${text}`);
      const data = JSON.parse(text);
      const entries = data.activeContracts || [];
      return entries.map((entry) => {
        const c = entry.contractEntry?.JsActiveContract?.createdEvent || entry.createdEvent || entry;
        return {
          contractId: c.contractId || entry.contractId,
          templateId: c.templateId || entry.templateId,
          payload: c.createArgument || c.argument || c.payload || entry.argument,
          createdAt: c.createdAt || entry.createdAt,
        };
      });
    });

    res.json({ contracts });
  };

  /**
   * POST /api/ledger/create
   * body: { templateId, createArguments, actAs?: "user"|"operator", readAs?: "user"|"operator", challenge, signatureBase64 }
   *
   * For MVP we require wallet challenge signature for create/exercise.
   */
  create = async (req, res) => {
    const userId = req.userId;
    const { templateId, createArguments, actAs, readAs, challenge, signatureBase64 } = req.body || {};
    if (!templateId || typeof templateId !== 'string') {
      return res.status(400).json({ error: 'templateId is required (string)' });
    }
    if (!createArguments || typeof createArguments !== 'object') {
      return res.status(400).json({ error: 'createArguments is required (object)' });
    }
    if (!challenge || !signatureBase64) {
      return res.status(401).json({ error: 'challenge + signatureBase64 required. Call GET /api/ledger/challenge then sign it in the browser.' });
    }

    await this.verifyChallengeSignatureOrThrow(userId, String(challenge), String(signatureBase64));

    const userPartyId = requirePartyId(userId);
    const operatorPartyId = config.canton.operatorPartyId;

    const actAsParty = actAs === 'operator' ? operatorPartyId : userPartyId;
    const readAsParty = readAs === 'operator' ? operatorPartyId : userPartyId;

    const synchronizerId = await this.onboardingService.discoverSynchronizerId();

    const result = await this.withCantonTokenRetry(async (token) => {
      return cantonService.createContract({
        token,
        actAsParty,
        templateId: await qualifyTemplateId(templateId, token),
        createArguments,
        readAs: [readAsParty],
        synchronizerId,
      });
    });

    res.json({ result });
  };

  /**
   * POST /api/ledger/exercise
   * body: { templateId, contractId, choice, choiceArgument, actAs?: "user"|"operator", readAs?: "user"|"operator", challenge, signatureBase64 }
   */
  exercise = async (req, res) => {
    const userId = req.userId;
    const { templateId, contractId, choice, choiceArgument, actAs, readAs, challenge, signatureBase64 } = req.body || {};
    if (!templateId || typeof templateId !== 'string') {
      return res.status(400).json({ error: 'templateId is required (string)' });
    }
    if (!contractId || typeof contractId !== 'string') {
      return res.status(400).json({ error: 'contractId is required (string)' });
    }
    if (!choice || typeof choice !== 'string') {
      return res.status(400).json({ error: 'choice is required (string)' });
    }
    if (!challenge || !signatureBase64) {
      return res.status(401).json({ error: 'challenge + signatureBase64 required. Call GET /api/ledger/challenge then sign it in the browser.' });
    }

    await this.verifyChallengeSignatureOrThrow(userId, String(challenge), String(signatureBase64));

    const userPartyId = requirePartyId(userId);
    const operatorPartyId = config.canton.operatorPartyId;
    const actAsParty = actAs === 'operator' ? operatorPartyId : userPartyId;
    const readAsParty = readAs === 'operator' ? operatorPartyId : userPartyId;

    const synchronizerId = await this.onboardingService.discoverSynchronizerId();

    const result = await this.withCantonTokenRetry(async (token) => {
      return cantonService.exerciseChoice({
        token,
        actAsParty,
        templateId: await qualifyTemplateId(templateId, token),
        contractId,
        choice,
        choiceArgument: choiceArgument ?? {},
        readAs: [readAsParty],
        synchronizerId,
      });
    });

    res.json({ result });
  };

  /**
   * GET /api/ledger/connected-synchronizers
   */
  connectedSynchronizers = async (req, res) => {
    // This endpoint is mainly for debugging; we expose synchronizerId used.
    const synchronizerId = await this.onboardingService.discoverSynchronizerId();
    res.json({ synchronizerId });
  };
}

module.exports = new LedgerProxyController();


