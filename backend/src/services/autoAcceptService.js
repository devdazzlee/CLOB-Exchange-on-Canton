/**
 * Auto-Accept Incoming Transfers Service
 *
 * Professional exchanges (Binance, Coinbase, Kraken) automatically accept
 * incoming token transfers — the user never has to manually approve them.
 *
 * This service continuously monitors for pending TransferInstruction contracts
 * on the Canton ledger and auto-accepts them on behalf of registered users.
 *
 * Flow:
 * 1. Poll for TransferInstruction contracts where our users are receivers
 * 2. For each pending instruction:
 *    a. Fetch accept choice context from the registry
 *    b. Prepare interactive submission (external party = receiver)
 *    c. Sign with the stored Ed25519 key for that party
 *    d. Execute the prepared submission → tokens arrive in user's wallet
 * 3. Track accepted contracts to avoid re-processing
 *
 * Why interactive submission?
 * - Our users are EXTERNAL parties (they signed with their own Ed25519 keys)
 * - TransferInstruction_Accept must be authorized by the receiver party
 * - For external parties, Canton requires interactive (prepare → sign → execute)
 * - The signing key was stored during onboarding (userRegistry.storeSigningKey)
 *
 * @see https://docs.sync.global/app_dev/token_standard/index.html
 * @see https://docs.digitalasset.com/utilities/devnet/how-tos/registry/transfer/transfer.html
 */

const config = require('../config');
const tokenProvider = require('./tokenProvider');
const userRegistry = require('../state/userRegistry');
const { UTILITIES_CONFIG, CANTON_SDK_CONFIG, getTokenSystemType } = require('../config/canton-sdk.config');
const { getRegistryApi } = require('../http/clients');

// Lazy-load modules to avoid circular dependencies
let cantonServiceInstance = null;
const getCantonService = () => {
  if (!cantonServiceInstance) {
    cantonServiceInstance = require('./cantonService');
  }
  return cantonServiceInstance;
};

// Ed25519 signing (same setup as canton-sdk-client.js)
let ed25519Module = null;
let sha512Module = null;

async function getEd25519() {
  if (!ed25519Module) {
    ed25519Module = require('@noble/ed25519');
    sha512Module = require('@noble/hashes/sha512');
    if (!ed25519Module.etc.sha512Sync) {
      ed25519Module.etc.sha512Sync = (...m) => sha512Module.sha512(ed25519Module.etc.concatBytes(...m));
    }
  }
  return ed25519Module;
}

async function signHash(privateKeyBase64, hashBase64) {
  const ed = await getEd25519();
  const privateKey = Buffer.from(privateKeyBase64, 'base64');
  const hashBytes = Buffer.from(hashBase64, 'base64');
  const signature = await ed.sign(hashBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

// ─── Constants ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15_000;   // Check every 15 seconds
const MAX_ACCEPT_RETRIES = 2;      // Retry failed accepts
const COOLDOWN_MS = 60_000;        // Wait 60s before retrying a failed contract
const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

class AutoAcceptService {
  constructor() {
    this.isRunning = false;
    this._pollTimer = null;
    this._processing = false;  // Guard against concurrent poll runs

    // Track contracts we've already accepted or failed on
    this._accepted = new Set();     // contractIds we successfully accepted
    this._failed = new Map();       // contractId → { count, lastAttempt }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[AutoAccept] 🚀 Starting Auto-Accept Service');
    console.log(`[AutoAccept]   Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
    console.log(`[AutoAccept]   Cooldown on failure: ${COOLDOWN_MS / 1000}s`);

    // Run first check immediately (non-blocking)
    this._runPollCycle().catch(err => {
      console.warn(`[AutoAccept] Initial poll failed: ${err.message}`);
    });

    // Schedule periodic polls
    this._pollTimer = setInterval(() => {
      this._runPollCycle().catch(err => {
        console.warn(`[AutoAccept] Poll cycle error: ${err.message}`);
      });
    }, POLL_INTERVAL_MS);
  }

  stop() {
    this.isRunning = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    console.log('[AutoAccept] Stopped');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POLL CYCLE — find and accept pending TransferInstructions
  // ═══════════════════════════════════════════════════════════════════════════

  async _runPollCycle() {
    if (this._processing) return; // Prevent overlapping runs
    this._processing = true;

    try {
      const cantonService = getCantonService();
      const token = await tokenProvider.getServiceToken();
      const operatorPartyId = config.canton.operatorPartyId;

      if (!operatorPartyId) {
        return; // Can't do anything without operator
      }

      // Get all registered party IDs from the database
      const partyIds = await userRegistry.getAllPartyIds();
      if (partyIds.length === 0) return;

      // Query TransferInstruction contracts visible to the operator
      // (operator has readAs on all external parties hosted on same participant)
      let transferInstructions = [];
      try {
        transferInstructions = await cantonService.queryActiveContracts({
          party: operatorPartyId,
          interfaceIds: [TRANSFER_INSTRUCTION_INTERFACE],
        }, token);
      } catch (err) {
        // Fallback: try querying per-party if operator can't see them all
        const errMsg = (err.message || '').substring(0, 100);
        if (errMsg.includes('413') || errMsg.includes('too many')) {
          console.warn('[AutoAccept] Too many contracts — querying per-party');
          for (const partyId of partyIds.slice(0, 10)) { // Limit to 10 parties per cycle
            try {
              const perParty = await cantonService.queryActiveContracts({
                party: partyId,
                interfaceIds: [TRANSFER_INSTRUCTION_INTERFACE],
              }, token);
              transferInstructions.push(...perParty);
            } catch (_) { /* skip */ }
          }
        } else {
          throw err;
        }
      }

      if (transferInstructions.length === 0) return;

      // Build a Set of our party IDs for fast lookup
      const ourParties = new Set(partyIds);

      // Filter to only instructions where:
      // 1. The RECEIVER is one of our parties
      // 2. We haven't already processed it
      // 3. It's not on cooldown from a failure
      const now = Date.now();
      const pending = [];

      for (const contract of transferInstructions) {
        const contractId = contract.contractId;
        if (!contractId) continue;

        // Skip already accepted
        if (this._accepted.has(contractId)) continue;

        // Skip on cooldown
        const failure = this._failed.get(contractId);
        if (failure && (now - failure.lastAttempt) < COOLDOWN_MS) continue;
        if (failure && failure.count >= MAX_ACCEPT_RETRIES) {
          // Permanently failed — don't retry
          continue;
        }

        // Extract receiver from the contract data
        const ifaceView = contract.createdEvent?.interfaceViews?.[0]?.viewValue || {};
        const payload = contract.payload || {};
        const transferData = ifaceView.transfer || payload.transfer || {};
        const receiver = transferData.receiver || ifaceView.receiver || payload.receiver || payload.recipient || payload.to || '';

        // Only auto-accept if the receiver is one of our registered users
        if (!receiver || !ourParties.has(receiver)) continue;

        // Extract metadata for logging and processing
        const sender = transferData.sender || ifaceView.sender || payload.sender || payload.from || 'unknown';
        const amount = transferData.amount || ifaceView.amount || payload.amount || '?';
        const instrumentId = transferData.instrumentId || ifaceView.instrumentId || payload.instrumentId || {};
        const tokenSymbol = instrumentId.id || instrumentId.instrument || payload.token || 'Unknown';
        const registrarParty = instrumentId.admin || null;

        pending.push({
          contractId,
          receiver,
          sender,
          amount,
          tokenSymbol,
          registrarParty,
          templateId: contract.createdEvent?.templateId || contract.templateId || '',
        });
      }

      if (pending.length > 0) {
        console.log(`[AutoAccept] 📬 Found ${pending.length} pending incoming transfer(s)`);
      }

      // Process each pending transfer
      for (const transfer of pending) {
        try {
          await this._autoAcceptTransfer(transfer, token);
        } catch (err) {
          console.error(`[AutoAccept] ❌ Failed to accept ${transfer.contractId.substring(0, 20)}...: ${err.message}`);

          // Track failure for cooldown
          const existing = this._failed.get(transfer.contractId) || { count: 0, lastAttempt: 0 };
          this._failed.set(transfer.contractId, {
            count: existing.count + 1,
            lastAttempt: now,
          });
        }
      }

    } catch (err) {
      // Don't log expected errors (token refresh, etc.)
      const msg = err.message || '';
      if (!msg.includes('security-sensitive') && !msg.includes('401')) {
        console.error(`[AutoAccept] Poll cycle error: ${msg.substring(0, 150)}`);
      }
    } finally {
      this._processing = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCEPT A SINGLE TRANSFER — Interactive Submission with stored key
  // ═══════════════════════════════════════════════════════════════════════════

  async _autoAcceptTransfer(transfer, adminToken) {
    const { contractId, receiver, sender, amount, tokenSymbol, registrarParty } = transfer;

    console.log(`[AutoAccept] 📨 Auto-accepting: ${amount} ${tokenSymbol} from ${sender.substring(0, 30)}... → ${receiver.substring(0, 30)}...`);

    // Step 1: Ensure we have the signing key for this party
    const signingKeyData = await userRegistry.getSigningKey(receiver);
    if (!signingKeyData || !signingKeyData.keyBase64) {
      console.warn(`[AutoAccept] ⚠️ No signing key stored for ${receiver.substring(0, 30)}... — skipping (user must re-onboard)`);
      // Mark as permanently failed so we don't retry
      this._failed.set(contractId, { count: MAX_ACCEPT_RETRIES, lastAttempt: Date.now() });
      return;
    }

    const cantonService = getCantonService();
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;

    // Step 2: Get the accept choice context from the registry
    const { disclosedContracts, choiceContextData } = await this._getAcceptChoiceContext(
      contractId, adminToken, synchronizerId, registrarParty, transfer.templateId
    );

    // Step 3: Prepare interactive submission
    const actAsParties = [receiver];
    const readAsParties = [receiver];
    if (operatorPartyId && operatorPartyId !== receiver) {
      readAsParties.push(operatorPartyId);
    }

    const prepareResult = await cantonService.prepareInteractiveSubmission({
      token: adminToken,
      actAsParty: actAsParties,
      templateId: TRANSFER_INSTRUCTION_INTERFACE,
      contractId,
      choice: 'TransferInstruction_Accept',
      choiceArgument: {
        extraArgs: {
          context: choiceContextData,
          meta: { values: {} },
        },
      },
      readAs: readAsParties,
      disclosedContracts,
      synchronizerId,
      verboseHashing: false,
    });

    if (!prepareResult.preparedTransaction || !prepareResult.preparedTransactionHash) {
      throw new Error('Prepare returned incomplete result');
    }

    console.log(`[AutoAccept]   ✅ Transaction prepared. Signing with stored key...`);

    // Step 4: Sign the prepared transaction hash with the stored Ed25519 key
    const signatureBase64 = await signHash(
      signingKeyData.keyBase64,
      prepareResult.preparedTransactionHash
    );

    // Step 5: Execute the signed transaction
    const partySignatures = {
      signatures: [{
        party: receiver,
        signatures: [{
          format: 'SIGNATURE_FORMAT_RAW',
          signature: signatureBase64,
          signedBy: signingKeyData.fingerprint || receiver,
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        }],
      }],
    };

    await cantonService.executeInteractiveSubmission({
      preparedTransaction: prepareResult.preparedTransaction,
      partySignatures,
      hashingSchemeVersion: prepareResult.hashingSchemeVersion || 'HASHING_SCHEME_VERSION_V2',
    }, adminToken);

    // Success!
    this._accepted.add(contractId);
    console.log(`[AutoAccept] ✅ Auto-accepted: ${amount} ${tokenSymbol} from ${sender.substring(0, 30)}... → ${receiver.substring(0, 30)}...`);

    // Broadcast balance update via WebSocket if available
    if (global.broadcastWebSocket) {
      try {
        const { getCantonSDKClient } = require('./canton-sdk-client');
        const sdkClient = getCantonSDKClient();
        if (sdkClient.isReady()) {
          const bal = await sdkClient.getAllBalances(receiver);
          global.broadcastWebSocket(`balance:${receiver}`, {
            type: 'BALANCE_UPDATE',
            partyId: receiver,
            balances: bal?.available || {},
            lockedBalances: bal?.locked || {},
            timestamp: Date.now(),
            reason: 'auto_accept_transfer',
          });
        }
      } catch (_) { /* non-critical */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHOICE CONTEXT RESOLUTION — Same logic as TransferOfferService
  // ═══════════════════════════════════════════════════════════════════════════

  async _getAcceptChoiceContext(contractId, adminToken, synchronizerId, registrarParty = null, templateHint = null) {
    const encodedCid = encodeURIComponent(contractId);
    const tokenStandardBase = UTILITIES_CONFIG.TOKEN_STANDARD_URL;
    const scanProxyBase = CANTON_SDK_CONFIG.REGISTRY_API_URL || 'http://65.108.40.104:8088';

    const isSpliceToken = templateHint?.includes('Amulet') || templateHint?.includes('Splice')
      || (registrarParty && registrarParty.startsWith('DSO::'));

    const urls = [];

    if (isSpliceToken) {
      urls.push(`${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      if (registrarParty) {
        urls.push(`${tokenStandardBase}/v0/registrars/${encodeURIComponent(registrarParty)}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      }
    } else {
      if (registrarParty) {
        urls.push(`${tokenStandardBase}/v0/registrars/${encodeURIComponent(registrarParty)}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      }
      urls.push(`${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
    }

    // Always add a fallback for both registries
    if (urls.length === 0) {
      urls.push(`${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
    }

    for (const url of urls) {
      try {
        const { data: ctx } = await getRegistryApi().post(url, { meta: {}, excludeDebugFields: true }, {
          headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
        });

        const disclosedContracts = (ctx.disclosedContracts || []).map(dc => ({
          templateId: dc.templateId,
          contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob,
          synchronizerId: dc.synchronizerId || synchronizerId,
        }));
        const choiceContextData = ctx.choiceContextData || ctx.choiceContext?.choiceContextData || { values: {} };
        return { disclosedContracts, choiceContextData };
      } catch (err) {
        const status = err.response?.status;
        const respData = typeof err.response?.data === 'string' ? err.response?.data : JSON.stringify(err.response?.data || {});

        if (status === 404 || respData.includes('CONTRACT_NOT_FOUND') || respData.includes('not found')) {
          // Contract already archived — mark as accepted so we skip it
          this._accepted.add(contractId);
          const gone = new Error(`TransferInstruction ${contractId.substring(0, 20)}... already archived/expired`);
          gone.code = 'CONTRACT_NOT_FOUND';
          throw gone;
        }
        // Try next URL
        continue;
      }
    }

    throw new Error(`Could not get accept choice context for ${contractId.substring(0, 20)}... after ${urls.length} endpoints`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP — Prevent memory leaks from unbounded Sets/Maps
  // ═══════════════════════════════════════════════════════════════════════════

  _cleanupTracking() {
    // Keep only the most recent 5000 accepted contract IDs
    if (this._accepted.size > 5000) {
      const arr = [...this._accepted];
      this._accepted = new Set(arr.slice(-3000));
    }

    // Remove old failures that have exceeded max retries
    const now = Date.now();
    for (const [cid, info] of this._failed) {
      if (info.count >= MAX_ACCEPT_RETRIES && (now - info.lastAttempt) > 24 * 60 * 60 * 1000) {
        this._failed.delete(cid); // Remove after 24h
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance = null;

function getAutoAcceptService() {
  if (!instance) {
    instance = new AutoAcceptService();
  }
  return instance;
}

module.exports = {
  AutoAcceptService,
  getAutoAcceptService,
};
