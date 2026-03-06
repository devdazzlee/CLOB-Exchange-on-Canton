/**
 * Auto-Accept Incoming Transfers Service — Event-Driven (WebSocket)
 *
 * Professional exchanges (Binance, Coinbase, Kraken) automatically accept
 * incoming token transfers — the user never has to manually approve them.
 *
 * Architecture (senior-level, zero polling):
 * ──────────────────────────────────────────
 *   1. Opens a DEDICATED WebSocket to Canton /v2/updates/flats filtered for
 *      TransferInstruction contracts (InterfaceFilter).
 *   2. The moment Canton creates a new TransferInstruction, the WS pushes it
 *      to this service in real-time — zero latency, zero polling.
 *   3. If the receiver is one of our registered users, we immediately accept it
 *      via the interactive submission flow (prepare → sign → execute).
 *   4. On startup, does ONE initial ACS scan to catch transfers that arrived
 *      while the service was offline — then switches to pure streaming.
 *
 * Why interactive submission?
 * - Our users are EXTERNAL parties (they signed with their own Ed25519 keys)
 * - TransferInstruction_Accept must be authorized by the receiver party
 * - For external parties, Canton requires interactive (prepare → sign → execute)
 * - The signing key was stored during onboarding (userRegistry.storeSigningKey)
 *
 * @see https://docs.sync.global/app_dev/token_standard/index.html
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const config = require('../config');
const tokenProvider = require('./tokenProvider');
const userRegistry = require('../state/userRegistry');
const { UTILITIES_CONFIG, CANTON_SDK_CONFIG } = require('../config/canton-sdk.config');
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
const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
const WS_RECONNECT_DELAY_MS = 5000;
const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 1000; // Refresh auth token every 4 min
const MAX_ACCEPT_RETRIES = 2;
const ACCEPT_CONCURRENCY = 3; // Max concurrent accept operations

class AutoAcceptService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this._stopped = false;

    // WebSocket connection for live streaming
    this._updatesWs = null;
    this._reconnectTimer = null;
    this._tokenRefreshTimer = null;
    this._lastOffset = null;

    // Track contracts we've already processed
    this._accepted = new Set();     // contractIds we successfully accepted
    this._archived = new Set();     // contractIds known to be archived
    this._failed = new Map();       // contractId → { count, lastAttempt }
    this._inProgress = new Set();   // contractIds currently being accepted

    // Queue for incoming transfer events
    this._acceptQueue = [];
    this._processingQueue = false;

    // Config
    const httpBase = config.canton.jsonApiBase || 'http://localhost:31539';
    this._wsBase = httpBase.replace(/^http/, 'ws');
    this._operatorPartyId = config.canton.operatorPartyId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._stopped = false;

    console.log('[AutoAccept] 🚀 Starting Auto-Accept Service (WebSocket streaming — zero polling)');

    // Step 1: Initial ACS scan — catch transfers that arrived while offline
    try {
      await this._initialACSScan();
    } catch (err) {
      console.warn(`[AutoAccept] Initial ACS scan failed (non-fatal): ${err.message}`);
    }

    // Step 2: Open live WebSocket stream — react to new transfers in real-time
    try {
      await this._connectUpdatesWebSocket();
    } catch (err) {
      console.warn(`[AutoAccept] WebSocket connection failed (will retry): ${err.message}`);
      this._scheduleReconnect();
    }
  }

  stop() {
    this._stopped = true;
    this.isRunning = false;

    if (this._updatesWs) {
      this._updatesWs.close();
      this._updatesWs = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._tokenRefreshTimer) {
      clearInterval(this._tokenRefreshTimer);
      this._tokenRefreshTimer = null;
    }

    console.log('[AutoAccept] Stopped');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: INITIAL ACS SCAN (one-time on startup)
  // Catch any TransferInstructions that arrived while the service was offline.
  // ═══════════════════════════════════════════════════════════════════════════

  async _initialACSScan() {
    const cantonService = getCantonService();
    const token = await tokenProvider.getServiceToken();

    if (!this._operatorPartyId) {
      console.warn('[AutoAccept] No operator party — skipping initial scan');
      return;
    }

    console.log('[AutoAccept] 📋 Running initial ACS scan for pending transfers...');

    const partyIds = await userRegistry.getAllPartyIds();
    if (partyIds.length === 0) {
      console.log('[AutoAccept] No registered users — nothing to scan');
      return;
    }

    let transferInstructions = [];
    try {
      transferInstructions = await cantonService.queryActiveContracts({
        party: this._operatorPartyId,
        interfaceIds: [TRANSFER_INSTRUCTION_INTERFACE],
      }, token);
    } catch (err) {
      console.warn(`[AutoAccept] ACS scan failed: ${err.message}`);
      return;
    }

    // Also fetch the current ledger offset so the WebSocket starts from here
    try {
      this._lastOffset = await cantonService.getLedgerEndOffset(token);
    } catch (_) {}

    if (transferInstructions.length === 0) {
      console.log('[AutoAccept] ✅ No pending transfers found in ACS');
      return;
    }

    console.log(`[AutoAccept] 📋 Found ${transferInstructions.length} TransferInstruction(s) in ACS`);

    const ourParties = new Set(partyIds);

    for (const contract of transferInstructions) {
      const transfer = this._extractTransferInfo(contract);
      if (!transfer) continue;
      if (!ourParties.has(transfer.receiver)) continue;

      // Queue for acceptance
      this._enqueueAccept(transfer);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: LIVE WEBSOCKET STREAM — /v2/updates/flats
  // Opens a persistent WebSocket that receives every new TransferInstruction
  // the instant it's created on the ledger. True push, zero polling.
  // ═══════════════════════════════════════════════════════════════════════════

  async _connectUpdatesWebSocket() {
    if (this._stopped) return;

    const token = await tokenProvider.getServiceToken();
    const url = `${this._wsBase}/v2/updates/flats`;

    console.log(`[AutoAccept] 🔌 Connecting WebSocket stream: ${url}`);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ['daml.ws.auth'], {
        handshakeTimeout: 15000,
        headers: { 'Authorization': `Bearer ${token}` },
      });

      ws.on('open', () => {
        console.log('[AutoAccept] ✅ WebSocket CONNECTED — streaming TransferInstruction events');

        // Subscribe to TransferInstruction via InterfaceFilter
        // This uses the operator party which has readAs on all external parties
        const filter = {
          verbose: false,
          beginExclusive: this._lastOffset || 0,
          filter: {
            filtersByParty: {
              [this._operatorPartyId]: {
                cumulative: [{
                  identifierFilter: {
                    InterfaceFilter: {
                      value: {
                        interfaceId: TRANSFER_INSTRUCTION_INTERFACE,
                        includeCreatedEventBlob: true,
                        includeInterfaceView: true,
                      },
                    },
                  },
                }],
              },
            },
          },
        };

        ws.send(JSON.stringify(filter));
        console.log(`[AutoAccept] 📡 Subscribed from offset ${this._lastOffset || 0}`);

        this._updatesWs = ws;
        this._startTokenRefresh();
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleUpdateMessage(msg);
        } catch (e) {
          // Ignore parse errors
        }
      });

      ws.on('close', (code, reason) => {
        const reasonStr = reason?.toString() || '';
        // Only log if not an intentional close
        if (code !== 1000 || !this._stopped) {
          console.warn(`[AutoAccept] ⚠️ WebSocket closed: ${code} ${reasonStr}`);
        }
        this._updatesWs = null;

        if (!this._stopped) {
          this._scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        console.error(`[AutoAccept] ❌ WebSocket error: ${err.message}`);
        // close event will handle reconnect
        if (!this._updatesWs) {
          reject(err);
        }
      });
    });
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer) return;

    console.log(`[AutoAccept] 🔄 Reconnecting in ${WS_RECONNECT_DELAY_MS / 1000}s...`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectUpdatesWebSocket().catch(err => {
        console.error(`[AutoAccept] Reconnect failed: ${err.message}`);
        this._scheduleReconnect();
      });
    }, WS_RECONNECT_DELAY_MS);
  }

  _startTokenRefresh() {
    if (this._tokenRefreshTimer) clearInterval(this._tokenRefreshTimer);

    this._tokenRefreshTimer = setInterval(async () => {
      if (this._stopped) return;
      try {
        console.log('[AutoAccept] 🔄 Token refresh — reconnecting WebSocket...');
        if (this._updatesWs) {
          this._updatesWs.close();
          // close handler will trigger reconnect
        }
      } catch (e) {
        console.warn(`[AutoAccept] Token refresh error: ${e.message}`);
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLE LIVE UPDATE MESSAGES — Same pattern as StreamingReadModel
  // ═══════════════════════════════════════════════════════════════════════════

  _handleUpdateMessage(msg) {
    const update = msg.update;
    if (!update) return;

    // Offset checkpoint — track position
    if (update.OffsetCheckpoint?.value?.offset != null) {
      this._lastOffset = update.OffsetCheckpoint.value.offset;
      return;
    }

    // Transaction update — process events
    const tx = update.Transaction?.value || update.Transaction;
    if (!tx || typeof tx !== 'object') return;

    const events = tx.events || [];

    for (const event of events) {
      // ── Created event ──────────────────────────────────────────────
      let created = null;
      if (event.CreatedEvent) {
        created = event.CreatedEvent.value || event.CreatedEvent;
      } else if (event.created) {
        created = event.created.value || event.created;
      } else if (event.createdEvent) {
        created = event.createdEvent.value || event.createdEvent;
      }

      if (created) {
        this._onTransferInstructionCreated(created);
      }

      // ── Archived event (track so we don't try to accept stale contracts)
      let archived = null;
      if (event.ArchivedEvent) {
        archived = event.ArchivedEvent.value || event.ArchivedEvent;
      } else if (event.archived) {
        archived = event.archived.value || event.archived;
      } else if (event.archivedEvent) {
        archived = event.archivedEvent.value || event.archivedEvent;
      }

      if (archived) {
        const cid = archived.contractId || archived.contract_id;
        if (cid) this._archived.add(cid);
      }

      // ── Exercised event (consuming = archived)
      let exercised = null;
      if (event.ExercisedEvent) {
        exercised = event.ExercisedEvent.value || event.ExercisedEvent;
      } else if (event.exercised) {
        exercised = event.exercised.value || event.exercised;
      } else if (event.exercisedEvent) {
        exercised = event.exercisedEvent.value || event.exercisedEvent;
      }

      if (exercised && (exercised.consuming === true || exercised.isConsuming === true)) {
        const cid = exercised.contractId || exercised.contract_id;
        if (cid) this._archived.add(cid);
      }
    }

    // Track offset
    if (tx.offset != null) {
      this._lastOffset = tx.offset;
    }
  }

  /**
   * Called the instant Canton streams a new TransferInstruction contract.
   * If the receiver is one of our users, queue it for immediate acceptance.
   */
  async _onTransferInstructionCreated(createdEvent) {
    const contractId = createdEvent.contractId || createdEvent.contract_id;
    if (!contractId) return;

    // Skip if already processed
    if (this._accepted.has(contractId) || this._archived.has(contractId) || this._inProgress.has(contractId)) return;

    // Extract transfer info from the interface view or payload
    const transfer = this._extractTransferInfoFromCreatedEvent(createdEvent);
    if (!transfer) return;

    // Check if receiver is one of our registered users
    const partyIds = await userRegistry.getAllPartyIds();
    const ourParties = new Set(partyIds);

    if (!ourParties.has(transfer.receiver)) return;

    console.log(`[AutoAccept] ⚡ New incoming transfer detected: ${transfer.amount} ${transfer.tokenSymbol} → ${transfer.receiver.substring(0, 30)}...`);

    // Queue for immediate acceptance
    this._enqueueAccept(transfer);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCEPT QUEUE — Processes accepts concurrently with bounded parallelism
  // ═══════════════════════════════════════════════════════════════════════════

  _enqueueAccept(transfer) {
    // Skip if already handled
    if (this._accepted.has(transfer.contractId) || this._archived.has(transfer.contractId)) return;
    if (this._inProgress.has(transfer.contractId)) return;

    // Skip if permanently failed
    const failure = this._failed.get(transfer.contractId);
    if (failure && failure.count >= MAX_ACCEPT_RETRIES) return;

    this._acceptQueue.push(transfer);
    this._processQueue();
  }

  async _processQueue() {
    if (this._processingQueue) return;
    this._processingQueue = true;

    try {
      while (this._acceptQueue.length > 0 && this._inProgress.size < ACCEPT_CONCURRENCY) {
        const transfer = this._acceptQueue.shift();
        if (!transfer) break;

        // Skip if already handled while queued
        if (this._accepted.has(transfer.contractId) || this._archived.has(transfer.contractId)) continue;
        if (this._inProgress.has(transfer.contractId)) continue;

        this._inProgress.add(transfer.contractId);

        // Fire-and-forget with error handling
        this._autoAcceptTransfer(transfer).catch(err => {
          // Error already logged in _autoAcceptTransfer
        }).finally(() => {
          this._inProgress.delete(transfer.contractId);
          // Process more items from the queue
          if (this._acceptQueue.length > 0) {
            this._processQueue();
          }
        });
      }
    } finally {
      this._processingQueue = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCEPT A SINGLE TRANSFER — Interactive Submission with stored key
  // ═══════════════════════════════════════════════════════════════════════════

  async _autoAcceptTransfer(transfer) {
    const { contractId, receiver, sender, amount, tokenSymbol, registrarParty, templateId } = transfer;

    try {
      // Check if archived while waiting in queue
      if (this._archived.has(contractId) || this._accepted.has(contractId)) return;

      console.log(`[AutoAccept] 📨 Accepting: ${amount} ${tokenSymbol} from ${sender.substring(0, 25)}... → ${receiver.substring(0, 25)}...`);

      // Step 1: Ensure we have the signing key for this party
      const signingKeyData = await userRegistry.getSigningKey(receiver);
      if (!signingKeyData || !signingKeyData.keyBase64) {
        console.warn(`[AutoAccept] ⚠️ No signing key for ${receiver.substring(0, 25)}... — skipping`);
        this._failed.set(contractId, { count: MAX_ACCEPT_RETRIES, lastAttempt: Date.now() });
        return;
      }

      const adminToken = await tokenProvider.getServiceToken();
      const cantonService = getCantonService();
      const synchronizerId = config.canton.synchronizerId;

      // Step 2: Get the accept choice context from the registry
      const { disclosedContracts, choiceContextData } = await this._getAcceptChoiceContext(
        contractId, adminToken, synchronizerId, registrarParty, templateId
      );

      // Step 3: Prepare interactive submission
      const actAsParties = [receiver];
      const readAsParties = [receiver];
      if (this._operatorPartyId && this._operatorPartyId !== receiver) {
        readAsParties.push(this._operatorPartyId);
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

      // Step 4: Sign with the stored Ed25519 key
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
      console.log(`[AutoAccept] ✅ Accepted: ${amount} ${tokenSymbol} → ${receiver.substring(0, 25)}...`);

      // Broadcast balance update via WebSocket
      this._broadcastBalanceUpdate(receiver);

    } catch (err) {
      const msg = err.message || '';

      // If contract is already gone, silently mark as archived — not an error
      if (err.code === 'CONTRACT_ARCHIVED' || msg.includes('archived') || msg.includes('expired')) {
        this._archived.add(contractId);
        return; // Silent — not an error, contract was already handled
      }

      console.error(`[AutoAccept] ❌ Failed ${contractId.substring(0, 20)}...: ${msg.substring(0, 120)}`);

      // Track failure
      const existing = this._failed.get(contractId) || { count: 0, lastAttempt: 0 };
      this._failed.set(contractId, {
        count: existing.count + 1,
        lastAttempt: Date.now(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHOICE CONTEXT RESOLUTION — Same logic as TransferOfferService
  // ═══════════════════════════════════════════════════════════════════════════

  async _getAcceptChoiceContext(contractId, adminToken, synchronizerId, registrarParty = null, templateHint = null) {
    const encodedCid = encodeURIComponent(contractId);
    const tokenStandardBase = UTILITIES_CONFIG.TOKEN_STANDARD_URL;
    const scanProxyBase = CANTON_SDK_CONFIG.REGISTRY_API_URL || 'http://65.108.40.104:8088';

    const isSpliceToken = (typeof templateHint === 'string' && (templateHint.includes('Amulet') || templateHint.includes('Splice')))
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
          // Contract already archived — mark so we skip it silently
          this._archived.add(contractId);
          const gone = new Error(`Contract ${contractId.substring(0, 20)}... already archived`);
          gone.code = 'CONTRACT_ARCHIVED';
          throw gone;
        }
        // Try next URL
        continue;
      }
    }

    throw new Error(`Could not get accept choice context for ${contractId.substring(0, 20)}... after ${urls.length} endpoints`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract transfer info from an ACS contract (queryActiveContracts result)
   */
  _extractTransferInfo(contract) {
    const contractId = contract.contractId;
    if (!contractId) return null;
    if (this._accepted.has(contractId) || this._archived.has(contractId)) return null;

    const ifaceView = contract.createdEvent?.interfaceViews?.[0]?.viewValue || {};
    const payload = contract.payload || {};
    const transferData = ifaceView.transfer || payload.transfer || {};

    const receiver = transferData.receiver || ifaceView.receiver || payload.receiver || payload.recipient || payload.to || '';
    if (!receiver) return null;

    const sender = transferData.sender || ifaceView.sender || payload.sender || payload.from || 'unknown';
    const amount = transferData.amount || ifaceView.amount || payload.amount || '?';
    const instrumentId = transferData.instrumentId || ifaceView.instrumentId || payload.instrumentId || {};
    const tokenSymbol = instrumentId.id || instrumentId.instrument || payload.token || 'Unknown';
    const registrarParty = instrumentId.admin || null;

    return {
      contractId,
      receiver,
      sender,
      amount,
      tokenSymbol,
      registrarParty,
      templateId: contract.createdEvent?.templateId || contract.templateId || '',
    };
  }

  /**
   * Extract transfer info from a live WebSocket CreatedEvent
   */
  _extractTransferInfoFromCreatedEvent(createdEvent) {
    const contractId = createdEvent.contractId || createdEvent.contract_id;
    if (!contractId) return null;

    // Interface views from live stream
    const interfaceViews = createdEvent.interfaceViews || [];
    let viewValue = {};
    for (const iv of interfaceViews) {
      if (iv.interfaceId?.includes('TransferInstruction') || iv.interfaceId?.includes('Holding')) {
        viewValue = iv.viewValue || iv.view || {};
        break;
      }
    }
    if (Object.keys(viewValue).length === 0 && interfaceViews.length > 0) {
      viewValue = interfaceViews[0]?.viewValue || interfaceViews[0]?.view || {};
    }

    const payload = createdEvent.createArgument || createdEvent.create_argument || createdEvent.payload || {};
    const transferData = viewValue.transfer || payload.transfer || {};

    const receiver = transferData.receiver || viewValue.receiver || payload.receiver || payload.recipient || payload.to || '';
    if (!receiver) return null;

    const sender = transferData.sender || viewValue.sender || payload.sender || payload.from || 'unknown';
    const amount = transferData.amount || viewValue.amount || payload.amount || '?';
    const instrumentId = transferData.instrumentId || viewValue.instrumentId || payload.instrumentId || {};
    const tokenSymbol = instrumentId.id || instrumentId.instrument || payload.token || 'Unknown';
    const registrarParty = instrumentId.admin || null;
    const templateId = createdEvent.templateId || createdEvent.template_id || '';

    return {
      contractId,
      receiver,
      sender,
      amount,
      tokenSymbol,
      registrarParty,
      templateId,
    };
  }

  /**
   * Broadcast balance update to frontend via WebSocket after accepting a transfer.
   */
  _broadcastBalanceUpdate(receiver) {
    if (!global.broadcastWebSocket) return;

    // Non-blocking — fire and forget
    (async () => {
      try {
        const { getCantonSDKClient } = require('./canton-sdk-client');
        const sdkClient = getCantonSDKClient();
        if (!sdkClient.isReady()) return;

        const bal = await sdkClient.getAllBalances(receiver);
        global.broadcastWebSocket(`balance:${receiver}`, {
          type: 'BALANCE_UPDATE',
          partyId: receiver,
          balances: bal?.available || {},
          lockedBalances: bal?.locked || {},
          timestamp: Date.now(),
          reason: 'auto_accept_transfer',
        });
      } catch (_) { /* non-critical */ }
    })();
  }

  /**
   * Cleanup tracking Sets/Maps to prevent memory leaks
   */
  _cleanupTracking() {
    if (this._accepted.size > 5000) {
      const arr = [...this._accepted];
      this._accepted = new Set(arr.slice(-3000));
    }
    if (this._archived.size > 10000) {
      const arr = [...this._archived];
      this._archived = new Set(arr.slice(-5000));
    }
    const now = Date.now();
    for (const [cid, info] of this._failed) {
      if (info.count >= MAX_ACCEPT_RETRIES && (now - info.lastAttempt) > 24 * 60 * 60 * 1000) {
        this._failed.delete(cid);
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
