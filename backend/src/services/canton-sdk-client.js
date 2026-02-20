/**
 * Canton Wallet SDK Client — Allocation-Based Settlement
 * 
 * Wraps the official @canton-network/wallet-sdk for the CLOB Exchange.
 * 
 * Provides:
 * - Balance queries via listHoldingUtxos (UTXO-based)
 * - Allocation-based settlement flow (replaces TransferInstruction)
 * - Allocation cancellation (for order cancellations)
 * 
 * Settlement is Allocation-based:
 * 1. At ORDER PLACEMENT: User creates Allocation (exchange = executor, funds locked)
 * 2. At MATCH TIME: Exchange executes Allocation with ITS OWN KEY (no user key needed)
 * 
 * Why Allocations instead of TransferInstructions:
 * - TransferInstruction requires the sender's private key at SETTLEMENT time
 * - With external parties, the backend has no user keys → TransferInstruction breaks
 * - Allocation: User signs ONCE at order time, exchange settles with its own key
 * - Works with external parties (users control their own keys, Confirmation permission)
 * 
 * @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-v1/
 * @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-instruction-v1/
 * @see https://docs.digitalasset.com/integrate/devnet/token-standard/index.html
 */

const { CANTON_SDK_CONFIG, UTILITIES_CONFIG, toCantonInstrument, toExchangeSymbol, extractInstrumentId, getTokenSystemType, getInstrumentAdmin } = require('../config/canton-sdk.config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const Decimal = require('decimal.js');

// Configure decimal precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// ─── Lazy-load SDK — loaded via dynamic import() in _doInitialize ───────────
// The SDK's CJS bundle require()s `jose` which is ESM-only (v5+).
// Static require() fails on Vercel's Node runtime with ERR_REQUIRE_ESM.
// Dynamic import() works universally for ESM modules.
let WalletSDKImpl = null;
let ClientCredentialOAuthController = null;
let LedgerController = null;
let TokenStandardController = null;
let ValidatorController = null;
let sdkLoadError = null;
let sdkLoaded = false;

// ─── SDK Client ────────────────────────────────────────────────────────────

class CantonSDKClient {
  constructor() {
    this.sdk = null;
    this.initialized = false;
    this.initError = null; // Set after initialize() if SDK fails to load
    this.instrumentAdminPartyId = null;
    this.currentPartyId = null;
    this._initPromise = null; // guards against concurrent initialize() calls

    // Simple sequential executor to prevent party-context races
    // SDK is stateful (setPartyId) so concurrent calls for different parties would conflict
    this._operationQueue = Promise.resolve();
  }

  /**
   * Initialize the SDK and connect to Canton
   * Call this once at server startup.
   * Safe to call concurrently — only the first call runs, others await the same promise.
   * Automatically retries with exponential backoff if initialization fails.
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    // If initialization is already in progress, await the same promise
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInitializeWithRetry();
    return this._initPromise;
  }

  /**
   * Retry wrapper around _doInitialize with exponential backoff.
   * Retries up to MAX_RETRIES times with delays of 5s, 10s, 20s, 40s, 60s.
   * If all retries fail, starts a background retry loop (every 60s).
   */
  async _doInitializeWithRetry() {
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 5000;
    const MAX_DELAY_MS = 60000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await this._doInitialize();
      if (this.initialized) {
        return; // Success
      }

      if (attempt < MAX_RETRIES) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
        console.warn(`[CantonSDK] ⏳ Retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s... (error: ${this.initError})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Reset state for retry
        this.initError = null;
        this.sdk = null;
      }
    }

    // All retries exhausted — start background retry loop
    if (!this.initialized) {
      console.error(`[CantonSDK] ❌ All ${MAX_RETRIES} initialization attempts failed. Starting background retry (every 60s)...`);
      this._startBackgroundRetry();
    }
  }

  /**
   * Background retry: Periodically attempts SDK initialization.
   * Stops once initialized successfully.
   */
  _startBackgroundRetry() {
    if (this._backgroundRetryTimer) return; // Already running

    this._backgroundRetryTimer = setInterval(async () => {
      if (this.initialized) {
        clearInterval(this._backgroundRetryTimer);
        this._backgroundRetryTimer = null;
        return;
      }
      console.log('[CantonSDK] 🔄 Background retry: attempting SDK initialization...');
      this.initError = null;
      this.sdk = null;
      await this._doInitialize();
      if (this.initialized) {
        console.log('[CantonSDK] ✅ Background retry SUCCEEDED — SDK is now ready!');
        clearInterval(this._backgroundRetryTimer);
        this._backgroundRetryTimer = null;
      } else {
        console.warn(`[CantonSDK] ⚠️ Background retry failed: ${this.initError}. Will retry in 60s...`);
      }
    }, 60000);
  }

  async _doInitialize() {

    // ── Step 0: Load the SDK package via dynamic import() ─────────────
    // Must use import() not require() because the SDK's CJS bundle
    // transitively require()s jose v5+ which is ESM-only.
    // Dynamic import() handles ESM modules correctly on all Node versions.
    if (!sdkLoaded) {
      try {
        console.log('[CantonSDK] Loading SDK via dynamic import()...');
        const walletSdk = await import('@canton-network/wallet-sdk');
        WalletSDKImpl = walletSdk.WalletSDKImpl;
        ClientCredentialOAuthController = walletSdk.ClientCredentialOAuthController;
        LedgerController = walletSdk.LedgerController;
        TokenStandardController = walletSdk.TokenStandardController;
        ValidatorController = walletSdk.ValidatorController;
        sdkLoaded = true;
        console.log('[CantonSDK] ✅ @canton-network/wallet-sdk loaded via import()');
      } catch (e) {
        sdkLoadError = `${e.code || 'UNKNOWN'}: ${e.message}`;
        console.error('[CantonSDK] ❌ SDK import() failed:', e.code, e.message);
        console.error('[CantonSDK] ❌ Stack:', (e.stack || '').split('\n').slice(0, 5).join('\n'));
      }
    }

    if (!WalletSDKImpl) {
      this.initError = `SDK package not loaded: ${sdkLoadError || 'import() failed'}`;
      console.error(`[CantonSDK] ❌ ${this.initError}`);
      return;
    }

    try {
      console.log('[CantonSDK] ═══════════════════════════════════════');
      console.log('[CantonSDK] Initializing Canton Wallet SDK...');
      console.log(`[CantonSDK]   Ledger API:   ${CANTON_SDK_CONFIG.LEDGER_API_URL}`);
      console.log(`[CantonSDK]   Validator:    ${CANTON_SDK_CONFIG.VALIDATOR_API_URL}`);
      console.log(`[CantonSDK]   Registry:     ${CANTON_SDK_CONFIG.REGISTRY_API_URL}`);
      console.log(`[CantonSDK]   Scan API:     ${CANTON_SDK_CONFIG.SCAN_API_URL}`);
      console.log('[CantonSDK] ═══════════════════════════════════════');

      const jsonApiUrl = CANTON_SDK_CONFIG.LEDGER_API_URL;
      const validatorUrl = CANTON_SDK_CONFIG.VALIDATOR_API_URL;
      const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
      const scanApiUrl = CANTON_SDK_CONFIG.SCAN_API_URL;

      // Keycloak client credentials
      const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
      const keycloakRealm = process.env.KEYCLOAK_REALM || 'canton-devnet';
      const keycloakConfigUrl = `${keycloakBaseUrl}/realms/${keycloakRealm}/.well-known/openid-configuration`;
      const clientId = (process.env.OAUTH_CLIENT_ID || '').trim();
      const clientSecret = (process.env.OAUTH_CLIENT_SECRET || '').trim();
      const oauthScope = process.env.OAUTH_SCOPE || 'openid profile email daml_ledger_api';
      const audience = jsonApiUrl;

      console.log(`[CantonSDK]   Keycloak:     ${keycloakConfigUrl}`);
      console.log(`[CantonSDK]   Client ID:    ${clientId.substring(0, 8)}...`);

      // Configure SDK with proper controller factories
      this.sdk = new WalletSDKImpl().configure({
        logger: console,

        // Auth factory — OAuth2 client credentials via Keycloak
        authFactory: () => {
          return new ClientCredentialOAuthController(
            keycloakConfigUrl,
            console,
            clientId,
            clientSecret,
            clientId,
            clientSecret,
            oauthScope,
            audience
          );
        },

        // Ledger factory — returns LedgerController connected to JSON Ledger API
        ledgerFactory: (userId, accessTokenProvider, isAdmin, accessToken = '') => {
          return new LedgerController(
            userId,
            new URL(jsonApiUrl),
            accessToken,
            isAdmin,
            accessTokenProvider
          );
        },

        // Token Standard factory — returns TokenStandardController
        tokenStandardFactory: (userId, accessTokenProvider, isAdmin, accessToken = '') => {
          return new TokenStandardController(
            userId,
            new URL(jsonApiUrl),
            new URL(validatorUrl),
            accessToken,
            accessTokenProvider,
            isAdmin,
            undefined,
            scanApiUrl
          );
        },

        // Validator factory — returns ValidatorController
        validatorFactory: (userId, accessTokenProvider, isAdmin = false, accessToken = '') => {
          return new ValidatorController(
            userId,
            new URL(validatorUrl),
            accessTokenProvider,
            isAdmin,
            accessToken
          );
        },
      });

      // Connect to Canton ledger
      await this.sdk.connect();
      console.log('[CantonSDK] ✅ Connected to Canton Ledger');

      // Set Transfer/Allocation Factory Registry URL
      this.sdk.tokenStandard?.setTransferFactoryRegistryUrl(new URL(registryUrl));
      console.log(`[CantonSDK] ✅ Factory Registry configured: ${registryUrl}`);

      // Discover instrument admin party (needed for allocations)
      try {
        this.instrumentAdminPartyId = await this.sdk.tokenStandard?.getInstrumentAdmin();
        console.log(`[CantonSDK] ✅ Instrument admin: ${this.instrumentAdminPartyId?.substring(0, 40)}...`);
      } catch (e) {
        console.warn(`[CantonSDK] ⚠️ Could not discover instrument admin via SDK: ${e.message}`);
        this.instrumentAdminPartyId = CANTON_SDK_CONFIG.INSTRUMENT_ADMIN_PARTY;
        if (!this.instrumentAdminPartyId) {
          try {
            const scanUrl = `${CANTON_SDK_CONFIG.SCAN_PROXY_URL}/api/scan/v0/amulet-rules`;
            const resp = await fetch(scanUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            if (resp.ok) {
              const data = await resp.json();
              const dso = data?.amulet_rules_update?.contract?.payload?.dso;
              if (dso) {
                this.instrumentAdminPartyId = dso;
                console.log(`[CantonSDK] ✅ Discovered DSO party from Scan API: ${dso.substring(0, 40)}...`);
              }
            }
          } catch (scanErr) {
            console.warn(`[CantonSDK] ⚠️ Scan API fallback failed: ${scanErr.message}`);
          }
        }
        if (this.instrumentAdminPartyId) {
          console.log(`[CantonSDK] Using instrument admin: ${this.instrumentAdminPartyId.substring(0, 40)}...`);
        } else {
          console.warn('[CantonSDK] ⚠️ No instrument admin configured — allocations will need it');
        }
      }

      this.initialized = true;
      console.log('[CantonSDK] ✅ SDK fully initialized and ready (Allocation-based settlement)');
    } catch (error) {
      console.error('[CantonSDK] ❌ Initialization failed:', error.message);
      if (error.stack) {
        console.error('[CantonSDK]   Stack:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      this.initError = error.message;
    }
  }

  /**
   * Check if SDK is ready for operations
   */
  isReady() {
    return this.initialized && this.sdk && this.sdk.tokenStandard;
  }

  /**
   * Get instrument admin for a given symbol
   */
  getInstrumentAdminForSymbol(symbol) {
    return getInstrumentAdmin(symbol, this.instrumentAdminPartyId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTY CONTEXT — thread-safe sequential execution
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with a specific party context.
   * Queues operations to prevent concurrent party-context conflicts.
   */
  async _withPartyContext(partyId, operation) {
    return new Promise((resolve, reject) => {
      this._operationQueue = this._operationQueue
        .catch(() => {})
        .then(async () => {
          try {
            if (this.currentPartyId !== partyId) {
              await this.sdk.setPartyId(partyId);
              this.currentPartyId = partyId;
              const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
              if (registryUrl && this.sdk.tokenStandard) {
                this.sdk.tokenStandard.setTransferFactoryRegistryUrl(new URL(registryUrl));
              }
            }
            const result = await operation();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOLDINGS & BALANCE — Query UTXOs from Canton Ledger
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all holdings (UTXOs) for a party
   */
  async getHoldings(partyId, includeLocked = false) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    return this._withPartyContext(partyId, async () => {
      try {
        const utxos = await this.sdk.tokenStandard?.listHoldingUtxos(includeLocked);
        return utxos || [];
      } catch (error) {
        console.error(`[CantonSDK] Failed to get holdings for ${partyId.substring(0, 30)}...:`, error.message);
        throw error;
      }
    });
  }

  /**
   * Get balance for a party and instrument
   * Calculates from UTXOs: total (all), available (unlocked), locked (in-allocation)
   */
  async getBalance(partyId, symbol) {
    if (!this.isReady()) {
      console.warn(`[CantonSDK] SDK not ready — returning zero balance for ${symbol}`);
      return { total: '0', available: '0', locked: '0' };
    }

    const instrumentId = toCantonInstrument(symbol);

    return this._withPartyContext(partyId, async () => {
      try {
        const allHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(true) || [];
        const availableHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];

        const filterAndSum = (holdings) => {
          return holdings
            .filter(h => {
              const holdingInstrument = extractInstrumentId(h.interfaceViewValue?.instrumentId);
              return holdingInstrument === instrumentId;
            })
            .reduce((sum, h) => {
              const amount = h.interfaceViewValue?.amount || '0';
              return sum.plus(new Decimal(amount));
            }, new Decimal(0));
        };

        const totalAmount = filterAndSum(allHoldings);
        const availableAmount = filterAndSum(availableHoldings);
        const lockedAmount = totalAmount.minus(availableAmount);

        return {
          total: totalAmount.toString(),
          available: availableAmount.toString(),
          locked: lockedAmount.toString(),
        };
      } catch (error) {
        console.error(`[CantonSDK] Balance query failed for ${partyId.substring(0, 30)}... ${symbol}:`, error.message);
        return { total: '0', available: '0', locked: '0' };
      }
    });
  }

  /**
   * Get all balances for a party (all instruments)
   */
  async getAllBalances(partyId) {
    if (!this.isReady()) {
      console.warn('[CantonSDK] SDK not ready — returning zero balances');
      return {
        available: { CC: '0', CBTC: '0' },
        locked: { CC: '0', CBTC: '0' },
        total: { CC: '0', CBTC: '0' },
      };
    }

    return this._withPartyContext(partyId, async () => {
      try {
        const allHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(true) || [];
        const availableHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];

        const available = {};
        const locked = {};
        const total = {};

        for (const h of allHoldings) {
          const rawInstr = h.interfaceViewValue?.instrumentId;
          if (!rawInstr) continue;
          const instrId = extractInstrumentId(rawInstr);
          const sym = toExchangeSymbol(instrId);
          const amount = new Decimal(h.interfaceViewValue?.amount || '0');
          total[sym] = (total[sym] ? new Decimal(total[sym]).plus(amount) : amount).toString();
        }

        for (const h of availableHoldings) {
          const rawInstr = h.interfaceViewValue?.instrumentId;
          if (!rawInstr) continue;
          const instrId = extractInstrumentId(rawInstr);
          const sym = toExchangeSymbol(instrId);
          const amount = new Decimal(h.interfaceViewValue?.amount || '0');
          available[sym] = (available[sym] ? new Decimal(available[sym]).plus(amount) : amount).toString();
        }

        for (const sym of Object.keys(total)) {
          const t = new Decimal(total[sym] || '0');
          const a = new Decimal(available[sym] || '0');
          locked[sym] = t.minus(a).toString();
          if (!available[sym]) available[sym] = '0';
        }

        return { available, locked, total };
      } catch (error) {
        console.error(`[CantonSDK] getAllBalances failed for ${partyId.substring(0, 30)}...:`, error.message);
        return {
          available: { CC: '0', CBTC: '0' },
          locked: { CC: '0', CBTC: '0' },
          total: { CC: '0', CBTC: '0' },
        };
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REAL TOKEN TRANSFERS — Uses Splice Transfer Factory API
  //
  // This is the ACTUAL token transfer mechanism that moves real Splice Holdings.
  // Used at MATCH TIME to settle trades between buyer and seller.
  //
  // Flow:
  // 1. SDK's createTransfer → exercises TransferFactory_Transfer → creates TransferInstruction
  // 2. SDK's exerciseTransferInstructionChoice('Accept') → moves the holding to receiver
  //
  // Token routing:
  // - CC (Amulet): Registry at Scan Proxy (http://65.108.40.104:8088)
  // - CBTC (Utilities): Registry at Utilities Backend (api/token-standard)
  //
  // NOTE: When Splice Allocation Factory becomes available on this network,
  // the allocation path (below) will automatically be preferred.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Perform a REAL token transfer between two parties.
   * 
   * Uses the Splice Transfer Factory API to create a TransferInstruction,
   * then immediately accepts it. This actually moves real Splice Holdings
   * (CC/CBTC) between wallets — visible on Canton Explorer.
   * 
   * @param {string} senderPartyId - Party sending the tokens
   * @param {string} receiverPartyId - Party receiving the tokens
   * @param {string} amount - Amount to transfer (as string)
   * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
   * @returns {Object} Result of the transfer acceptance
   */
  /**
   * Perform a real token transfer using the Transfer Factory Registry API.
   * 
   * This is the FALLBACK path — only used if Allocation-based settlement
   * is not available (e.g., no allocation CID on order). The PREFERRED
   * path is always Allocation API (createAllocation → executeAllocation).
   * 
   * Uses the Transfer Factory registry endpoint directly (not the SDK's
   * createTransfer, which generates incorrect payloads).
   * 
   * Correct endpoint: /registry/transfer-instruction/v1/transfer-factory
   * Confirmed payload structure via live API probing.
   */
  async performTransfer(senderPartyId, receiverPartyId, amount, symbol) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    const instrumentId = toCantonInstrument(symbol);
    const adminParty = this.getInstrumentAdminForSymbol(symbol);
    const tokenType = getTokenSystemType(symbol);

    console.log(`[CantonSDK] 🔄 Transfer (fallback): ${amount} ${symbol} (${instrumentId})`);
    console.log(`[CantonSDK]    From: ${senderPartyId.substring(0, 30)}...`);
    console.log(`[CantonSDK]    To:   ${receiverPartyId.substring(0, 30)}...`);

    // Get sender's holdings for this instrument
    const holdings = await this._withPartyContext(senderPartyId, async () => {
      return await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];
    });

    const holdingCids = holdings
      .filter(h => extractInstrumentId(h.interfaceViewValue?.instrumentId) === instrumentId)
      .map(h => h.contractId);

    if (holdingCids.length === 0) {
      throw new Error(`No ${symbol} holdings found for sender ${senderPartyId.substring(0, 30)}...`);
    }

    console.log(`[CantonSDK]    Found ${holdingCids.length} ${symbol} holding UTXOs`);

    // ── Build Transfer Factory URL ─────────────────────────────────────
    const registryUrl = this._getTransferFactoryUrl(tokenType);
    const now = new Date().toISOString();
    const executeBefore = new Date(Date.now() + 86400000).toISOString();

    // ── Step 1: POST to Transfer Factory to get context ────────────────
    console.log(`[CantonSDK]    📤 Calling Transfer Factory: ${registryUrl}`);
    const factoryResponse = await fetch(registryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choiceArguments: {
          expectedAdmin: adminParty,
          transfer: {
            sender: senderPartyId,
            receiver: receiverPartyId,
            amount: amount.toString(),
            instrumentId: { id: instrumentId, admin: adminParty },
            requestedAt: now,
            executeBefore,
            inputHoldingCids: holdingCids,
            meta: { values: {} },
          },
          extraArgs: {
            context: { values: {} },
            meta: { values: {} },
          },
        },
        excludeDebugFields: true,
      }),
    });

    if (!factoryResponse.ok) {
      const errorText = await factoryResponse.text();
      throw new Error(`Transfer Factory API failed (${factoryResponse.status}): ${errorText.substring(0, 300)}`);
    }

    const factory = await factoryResponse.json();
    console.log(`[CantonSDK]    ✅ Transfer Factory returned — factoryId: ${factory.factoryId?.substring(0, 30)}...`);

    // ── Step 2: Exercise TransferFactory_Transfer on the factory ────────
    const TRANSFER_FACTORY_INTERFACE = UTILITIES_CONFIG.TRANSFER_FACTORY_INTERFACE
      || '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';
    
    const adminToken = await tokenProvider.getServiceToken();
    const configModule = require('../config');
    const synchronizerId = configModule.canton.synchronizerId;

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: [senderPartyId],
      templateId: TRANSFER_FACTORY_INTERFACE,
      contractId: factory.factoryId,
      choice: 'TransferFactory_Transfer',
      choiceArgument: {
        expectedAdmin: adminParty,
        transfer: {
          sender: senderPartyId,
          receiver: receiverPartyId,
          amount: amount.toString(),
          instrumentId: { id: instrumentId, admin: adminParty },
          requestedAt: now,
          executeBefore,
          inputHoldingCids: holdingCids,
          meta: { values: {} },
        },
        extraArgs: {
          context: factory.choiceContext?.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
      readAs: [senderPartyId, receiverPartyId],
      synchronizerId,
      disclosedContracts: (factory.choiceContext?.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId || synchronizerId,
      })),
    });

    // Find TransferInstruction CID from the result
    let tiCid = null;
    for (const event of (result?.transaction?.events || [])) {
      const created = event.created || event.CreatedEvent;
      if (created?.contractId) {
        const tpl = typeof created.templateId === 'string' ? created.templateId : '';
        if (tpl.includes('TransferInstruction') || tpl.includes('Transfer')) {
          tiCid = created.contractId;
          break;
        }
      }
    }

    if (!tiCid) {
      console.log(`[CantonSDK]    ℹ️ No TransferInstruction found — transfer may have auto-completed`);
      return result;
    }

    // ── Step 3: Accept the TransferInstruction as receiver ─────────────
    // CRITICAL: AmuletTransferInstruction has signatories: admin (instrumentId.admin) + sender.
    // When receiver exercises Accept, Canton needs ALL parties on the same participant in actAs.
    // Since sender + receiver are both external wallet users on the SAME participant,
    // BOTH must be in actAs to satisfy the authorization check.
    console.log(`[CantonSDK]    📨 TransferInstruction created: ${tiCid.substring(0, 30)}...`);
    console.log(`[CantonSDK]    ✅ Accepting as receiver (with sender co-auth)...`);

    const acceptActAs = [receiverPartyId, senderPartyId];
    const acceptReadAs = [receiverPartyId, senderPartyId];

    const acceptResult = await this._withPartyContext(receiverPartyId, async () => {
      try {
        const [acceptCmd, acceptDisclosed] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
          tiCid,
          'Accept'
        );

        const commands = Array.isArray(acceptCmd) ? acceptCmd : [acceptCmd];
        let res = null;
        for (const rawCmd of commands) {
          const cmd = rawCmd.ExerciseCommand || rawCmd;
          res = await cantonService.exerciseChoice({
            token: adminToken,
            actAsParty: acceptActAs,
            templateId: cmd.templateId,
            contractId: cmd.contractId,
            choice: cmd.choice,
            choiceArgument: cmd.choiceArgument,
            readAs: acceptReadAs,
            synchronizerId,
            disclosedContracts: (acceptDisclosed || []).map(dc => ({
              templateId: dc.templateId,
              contractId: dc.contractId,
              createdEventBlob: dc.createdEventBlob,
              synchronizerId: dc.synchronizerId || synchronizerId,
            })),
          });
        }
        console.log(`[CantonSDK]    ✅ Transfer ACCEPTED — real ${symbol} tokens moved!`);
        return res;
      } catch (sdkAcceptErr) {
        // SDK accept failed — try direct registry accept
        console.warn(`[CantonSDK]    SDK accept failed: ${sdkAcceptErr.message} — trying registry API`);
        const acceptUrl = `${this._getRegistryBaseUrl(tokenType)}/registry/transfer-instructions/v1/${encodeURIComponent(tiCid)}/choice-contexts/accept`;
        const acceptResp = await fetch(acceptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ excludeDebugFields: true }),
        });
        if (!acceptResp.ok) {
          throw new Error(`Accept API failed (${acceptResp.status}): ${(await acceptResp.text()).substring(0, 200)}`);
        }
        const acceptCtx = await acceptResp.json();
        const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
        const res = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: acceptActAs,
          templateId: TRANSFER_INSTRUCTION_INTERFACE,
          contractId: tiCid,
          choice: 'TransferInstruction_Accept',
          choiceArgument: {
            extraArgs: {
              context: acceptCtx.choiceContextData || { values: {} },
              meta: { values: {} },
            },
          },
          readAs: acceptReadAs,
          synchronizerId,
          disclosedContracts: (acceptCtx.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          })),
        });
        console.log(`[CantonSDK]    ✅ Transfer ACCEPTED via registry API — real ${symbol} tokens moved!`);
        return res;
      }
    });

    return acceptResult;
  }

  /**
   * Accept a TransferInstruction (transfer offer) — used by TransferOfferService.
   * 
   * This exercises `TransferInstruction_Accept` on the Canton ledger directly.
   * The receiver exercises the Accept choice. Since all parties are on the same
   * participant, both receiver AND the instruction's sender must be in actAs.
   * 
   * @param {string} transferInstructionCid - The TransferInstruction contract ID
   * @param {string} receiverPartyId - The party accepting (receiver of tokens)
   * @param {string} symbol - Token symbol (CC, CBTC) for routing to correct registry
   * @returns {Object} Exercise result
   */
  async acceptTransfer(transferInstructionCid, receiverPartyId, symbol = null) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    console.log(`[CantonSDK] 📨 Accepting transfer: ${transferInstructionCid.substring(0, 30)}... for ${receiverPartyId.substring(0, 30)}...`);

    const tokenType = symbol ? getTokenSystemType(symbol) : null;
    const adminToken = await tokenProvider.getServiceToken();
    const configModule = require('../config');
    const synchronizerId = configModule.canton.synchronizerId;
    const operatorPartyId = configModule.canton.operatorPartyId;

    const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    // actAs needs BOTH receiver + operator (operator hosts all external parties)
    const actAsParties = [receiverPartyId];
    if (operatorPartyId && operatorPartyId !== receiverPartyId) {
      actAsParties.push(operatorPartyId);
    }

    // Try SDK method first
    try {
      if (this.sdk.tokenStandard && typeof this.sdk.tokenStandard.exerciseTransferInstructionChoice === 'function') {
        return await this._withPartyContext(receiverPartyId, async () => {
          const [acceptCmd, acceptDisclosed] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
            transferInstructionCid,
            'Accept'
          );

          const commands = Array.isArray(acceptCmd) ? acceptCmd : [acceptCmd];
          let result = null;
          for (const rawCmd of commands) {
            const cmd = rawCmd.ExerciseCommand || rawCmd;
            result = await cantonService.exerciseChoice({
              token: adminToken,
              actAsParty: actAsParties,
              templateId: cmd.templateId,
              contractId: cmd.contractId,
              choice: cmd.choice,
              choiceArgument: cmd.choiceArgument,
              readAs: actAsParties,
              synchronizerId,
              disclosedContracts: (acceptDisclosed || []).map(dc => ({
                templateId: dc.templateId,
                contractId: dc.contractId,
                createdEventBlob: dc.createdEventBlob,
                synchronizerId: dc.synchronizerId || synchronizerId,
              })),
            });
          }
          console.log(`[CantonSDK]    ✅ Transfer accepted via SDK`);
          return result;
        });
      }
    } catch (sdkErr) {
      console.warn(`[CantonSDK]    SDK exerciseTransferInstructionChoice failed: ${sdkErr.message} — trying registry API`);
    }

    // Fallback: Get accept choice context from registry API, then exercise directly
    const registryBase = this._getRegistryBaseUrl(tokenType);
    const acceptContextUrl = `${registryBase}/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionCid)}/choice-contexts/accept`;

    console.log(`[CantonSDK]    Trying registry accept context: ${acceptContextUrl.substring(0, 100)}...`);

    const contextResp = await fetch(acceptContextUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludeDebugFields: true }),
    });

    if (!contextResp.ok) {
      const errText = await contextResp.text();
      throw new Error(`Accept context API failed (${contextResp.status}): ${errText.substring(0, 200)}`);
    }

    const acceptCtx = await contextResp.json();
    console.log(`[CantonSDK]    ✅ Got accept context (${acceptCtx.disclosedContracts?.length || 0} disclosed contracts)`);

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: actAsParties,
      templateId: TRANSFER_INSTRUCTION_INTERFACE,
      contractId: transferInstructionCid,
      choice: 'TransferInstruction_Accept',
      choiceArgument: {
        extraArgs: {
          context: acceptCtx.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
      readAs: actAsParties,
      synchronizerId,
      disclosedContracts: (acceptCtx.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId || synchronizerId,
      })),
    });

    console.log(`[CantonSDK]    ✅ Transfer accepted via registry API`);
    return result;
  }

  /**
   * Get the Transfer Factory URL for a token type.
   * - CC (splice):     /registry/transfer-instruction/v1/transfer-factory
   * - CBTC (utilities): {backend}/v0/registrars/{admin}/registry/transfer-instruction/v1/transfer-factory
   */
  _getTransferFactoryUrl(tokenType) {
    if (tokenType === 'utilities') {
      const adminParty = getInstrumentAdmin('CBTC');
      return `${UTILITIES_CONFIG.BACKEND_URL}/v0/registrars/${encodeURIComponent(adminParty)}/registry/transfer-instruction/v1/transfer-factory`;
    }
    return `${CANTON_SDK_CONFIG.REGISTRY_API_URL}/registry/transfer-instruction/v1/transfer-factory`;
  }

  /**
   * Get the base registry URL for a token type (for building sub-paths).
   */
  _getRegistryBaseUrl(tokenType) {
    if (tokenType === 'utilities') {
      const adminParty = getInstrumentAdmin('CBTC');
      return `${UTILITIES_CONFIG.BACKEND_URL}/v0/registrars/${encodeURIComponent(adminParty)}`;
    }
    return CANTON_SDK_CONFIG.REGISTRY_API_URL;
  }

  /**
   * Get the correct Transfer Factory Registry URL for a token type (legacy).
   */
  _getRegistryUrlForToken(tokenType) {
    if (tokenType === 'utilities') {
      const adminParty = getInstrumentAdmin('CBTC');
      return `${UTILITIES_CONFIG.BACKEND_URL}/v0/registrars/${encodeURIComponent(adminParty)}`;
    }
    return CANTON_SDK_CONFIG.REGISTRY_API_URL;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALLOCATIONS — Settlement via Allocation API
  //
  // CC (Splice/Amulet): Allocation Factory IS available on Scan Proxy
  //   POST /registry/allocation-instruction/v1/allocation-factory → 200
  //   POST /registry/allocations/v1/{id}/choice-contexts/execute-transfer → available
  //
  // CBTC (Utilities): Allocation Factory NOT yet available (404)
  //   Falls back to Transfer Factory API for CBTC settlement
  //
  // Architecture:
  // 1. At ORDER PLACEMENT: User creates Allocation (exchange = executor)
  // 2. At MATCH TIME: Exchange executes Allocation with its OWN key
  // 3. At CANCEL: Exchange cancels Allocation, funds returned to user
  //
  // @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-v1/
  // @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-instruction-v1/
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create an Allocation for an order.
   * 
   * Called at ORDER PLACEMENT time. Locks the user's holdings and sets the
   * exchange as executor. The exchange can later execute this allocation
   * at match time without needing the user's key.
   * 
   * @param {string} senderPartyId - The order placer (funds locked from this party)
   * @param {string} receiverPartyId - The counterparty (null if unknown at order time)
   * @param {string} amount - Amount to allocate (as string)
   * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
   * @param {string} executorPartyId - The exchange party (settles at match time)
   * @param {string} orderId - Order ID for tracking (used in memo)
   * @returns {Object} { allocationContractId, result }
   */
  async createAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId = '') {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    const instrumentId = toCantonInstrument(symbol);
    const tokenSystemType = getTokenSystemType(symbol);
    const adminParty = this.getInstrumentAdminForSymbol(symbol);

    console.log(`[CantonSDK] 📋 Creating Allocation: ${amount} ${symbol} (${instrumentId})`);
    console.log(`[CantonSDK]    Sender: ${senderPartyId.substring(0, 30)}...`);
    console.log(`[CantonSDK]    Receiver: ${receiverPartyId ? receiverPartyId.substring(0, 30) + '...' : 'TBD (set at match)'}`);
    console.log(`[CantonSDK]    Executor: ${executorPartyId.substring(0, 30)}...`);

    // Route to correct API based on token system type
    if (tokenSystemType === 'utilities') {
      return this._createUtilitiesAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId);
    }
    return this._createSpliceAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId);
  }

  /**
   * Build the correct allocation choiceArguments structure.
   * 
   * VERIFIED against live Splice & Utilities endpoints (2026-02-17):
   * 
   * choiceArguments = {
   *   expectedAdmin,
   *   allocation: {
   *     settlement: { executor, settleBefore, allocateBefore, settlementRef: {id}, requestedAt, meta },
   *     transferLegId,
   *     transferLeg: { sender, receiver, amount, instrumentId: {id, admin}, meta }
   *   },
   *   requestedAt,         // top-level, separate from settlement.requestedAt
   *   inputHoldingCids,    // outside allocation, at choiceArguments level
   *   extraArgs: { context, meta }
   * }
   */
  _buildAllocationChoiceArgs(params) {
    const {
      adminParty, senderPartyId, receiverPartyId, executorPartyId,
      amount, instrumentId, orderId, holdingCids,
      choiceContextData,
    } = params;

      const now = new Date().toISOString();
      const settleBefore = new Date(Date.now() + 86400000).toISOString(); // 24 hours
      const allocateBefore = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    return {
      expectedAdmin: adminParty,
      allocation: {
        settlement: {
          executor: executorPartyId,
          settleBefore,
          allocateBefore,
          settlementRef: { id: orderId || `settlement-${Date.now()}` },
          requestedAt: now,
          meta: { values: {} },
        },
        transferLegId: orderId || `leg-${Date.now()}`,
        transferLeg: {
          sender: senderPartyId,
          receiver: receiverPartyId || executorPartyId,
          amount: amount.toString(),
          instrumentId: { id: instrumentId, admin: adminParty },
          meta: { values: {} },
          },
        },
      requestedAt: now,
        inputHoldingCids: holdingCids,
      extraArgs: {
        context: choiceContextData || { values: {} },
        meta: { values: {} },
      },
    };
  }

  /**
   * Create allocation for Splice tokens (CC/Amulet) via registry API.
   */
  async _createSpliceAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId) {
    const instrumentId = toCantonInstrument(symbol);
    const adminParty = this.instrumentAdminPartyId;

    return this._withPartyContext(senderPartyId, async () => {
      // Get sender's available holdings for auto-selection
      const holdings = await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];
      const holdingCids = holdings
        .filter(h => extractInstrumentId(h.interfaceViewValue?.instrumentId) === instrumentId)
        .map(h => h.contractId);

      if (holdingCids.length === 0) {
        throw new Error(`No ${symbol} holdings found for sender ${senderPartyId.substring(0, 30)}...`);
      }

      console.log(`[CantonSDK]    Found ${holdingCids.length} ${symbol} holding UTXOs`);

      // ── Call registry API to get the allocation factory context ─────
        const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
      const allocationFactoryUrl = `${registryUrl}/registry/allocation-instruction/v1/allocation-factory`;

      const choiceArgs = this._buildAllocationChoiceArgs({
        adminParty, senderPartyId, receiverPartyId, executorPartyId,
        amount, instrumentId, orderId, holdingCids,
        choiceContextData: null,
      });

      console.log(`[CantonSDK]    Calling Splice allocation-factory: ${allocationFactoryUrl}`);

          const factoryResponse = await fetch(allocationFactoryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
          choiceArguments: choiceArgs,
              excludeDebugFields: true,
            }),
          });

      if (!factoryResponse.ok) {
            const errorText = await factoryResponse.text();
        throw new Error(`Splice allocation factory API failed (${factoryResponse.status}): ${errorText.substring(0, 300)}`);
      }

      const factory = await factoryResponse.json();
      console.log(`[CantonSDK]    ✅ Splice allocation factory returned — factoryId: ${factory.factoryId?.substring(0, 30)}...`);

      // ── Build exercise command with real choice context from factory ─
      const exerciseArgs = this._buildAllocationChoiceArgs({
        adminParty, senderPartyId, receiverPartyId, executorPartyId,
        amount, instrumentId, orderId, holdingCids,
        choiceContextData: factory.choiceContext?.choiceContextData,
      });

      const adminToken = await tokenProvider.getServiceToken();
      const configModule = require('../config');
      const synchronizerId = configModule.canton.synchronizerId;

        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [senderPartyId],
        templateId: UTILITIES_CONFIG.ALLOCATION_INSTRUCTION_FACTORY_INTERFACE,
        contractId: factory.factoryId,
        choice: 'AllocationFactory_Allocate',
        choiceArgument: exerciseArgs,
          readAs: [senderPartyId, executorPartyId],
        synchronizerId,
        disclosedContracts: (factory.choiceContext?.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          })),
        });

        return this._extractAllocationResult(result, orderId);
    });
  }

  /**
   * Create allocation for Utilities tokens (CBTC) via Utilities Backend API.
   */
  async _createUtilitiesAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId) {
    const instrumentId = toCantonInstrument(symbol);
    const adminParty = getInstrumentAdmin(symbol);

    if (!adminParty) {
      throw new Error(`No admin party configured for ${symbol} (${instrumentId})`);
    }

    console.log(`[CantonSDK]    Using Utilities Backend API for ${symbol} allocation`);

    // Get sender's holdings via SDK
    const holdings = await this._withPartyContext(senderPartyId, async () => {
      return await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];
    });

    const holdingCids = holdings
      .filter(h => extractInstrumentId(h.interfaceViewValue?.instrumentId) === instrumentId)
      .map(h => h.contractId);

    if (holdingCids.length === 0) {
      throw new Error(`No ${symbol} holdings found for sender ${senderPartyId.substring(0, 30)}...`);
    }

    console.log(`[CantonSDK]    Found ${holdingCids.length} ${symbol} holding UTXOs`);

    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const allocationFactoryUrl = `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/allocation-instruction/v1/allocation-factory`;

    // Build choiceArguments with the correct nested structure
    const choiceArgs = this._buildAllocationChoiceArgs({
      adminParty, senderPartyId, receiverPartyId, executorPartyId,
      amount, instrumentId, orderId, holdingCids,
      choiceContextData: null,
    });

    console.log(`[CantonSDK]    Calling Utilities allocation-factory: ${allocationFactoryUrl}`);

      const factoryResponse = await fetch(allocationFactoryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choiceArguments: choiceArgs,
        excludeDebugFields: true,
      }),
    });

    if (!factoryResponse.ok) {
      const errorText = await factoryResponse.text();
      throw new Error(`Utilities allocation factory API failed (${factoryResponse.status}): ${errorText.substring(0, 300)}`);
    }

    const factory = await factoryResponse.json();
    console.log(`[CantonSDK]    ✅ Utilities allocation factory returned — factoryId: ${factory.factoryId?.substring(0, 30)}...`);

    // Build exercise command with real choice context from factory
    const exerciseArgs = this._buildAllocationChoiceArgs({
      adminParty, senderPartyId, receiverPartyId, executorPartyId,
      amount, instrumentId, orderId, holdingCids,
      choiceContextData: factory.choiceContext?.choiceContextData,
    });

    const adminToken = await tokenProvider.getServiceToken();
    const configModule = require('../config');
    const synchronizerId = configModule.canton.synchronizerId;

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: [senderPartyId],
      templateId: UTILITIES_CONFIG.ALLOCATION_INSTRUCTION_FACTORY_INTERFACE,
      contractId: factory.factoryId,
        choice: 'AllocationFactory_Allocate',
      choiceArgument: exerciseArgs,
        readAs: [senderPartyId, executorPartyId],
      synchronizerId,
      disclosedContracts: (factory.choiceContext?.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId || synchronizerId,
      })),
    });

      return this._extractAllocationResult(result, orderId);
  }

  // NOTE: _createDirectAllocation (AllocationRecord fallback) has been REMOVED.
  // CC allocations use the real Splice Allocation Factory API.
  // CBTC falls back to Transfer API at match time if allocation not available.

  /**
   * Extract Allocation contract ID from exercise result.
   */
  _extractAllocationResult(result, orderId) {
    let allocationContractId = null;
    const events = result?.transaction?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent;
      if (created?.contractId) {
        const templateId = created.templateId || '';
        if (typeof templateId === 'string' && 
            (templateId.includes('Allocation') || templateId.includes('AllocationRecord'))) {
          allocationContractId = created.contractId;
          break;
        }
      }
    }

    if (!allocationContractId) {
      // Fallback: take the first created contract
      for (const event of events) {
        const created = event.created || event.CreatedEvent;
        if (created?.contractId) {
          allocationContractId = created.contractId;
          break;
        }
      }
    }

    if (allocationContractId) {
      console.log(`[CantonSDK]    ✅ Allocation created: ${allocationContractId.substring(0, 30)}...`);
    } else {
      console.log(`[CantonSDK]    ℹ️ No Allocation contract found in result — may have auto-completed`);
    }

    return {
      allocationContractId,
      result,
      orderId,
      updateId: result?.transaction?.updateId,
    };
  }

  /**
   * Fetch pending Allocation requests for a party.
   * Used to check if allocations exist before settlement.
   * 
   * @param {string} partyId - Party to query
   * @returns {Array} Pending allocation request views
   */
  async fetchPendingAllocationRequests(partyId) {
    if (!this.isReady()) return [];

    return this._withPartyContext(partyId, async () => {
      try {
        if (typeof this.sdk.tokenStandard?.fetchPendingAllocationRequestView === 'function') {
          const requests = await this.sdk.tokenStandard.fetchPendingAllocationRequestView();
          console.log(`[CantonSDK] Found ${requests?.length || 0} pending allocation requests for ${partyId.substring(0, 30)}...`);
          return requests || [];
        }
        return [];
      } catch (error) {
        console.warn(`[CantonSDK] fetchPendingAllocationRequests failed: ${error.message}`);
        return [];
      }
    });
  }

  /**
   * Fetch pending Allocations (ready for execution).
   * Exchange checks these at match time before executing.
   * 
   * @param {string} partyId - Party to query (executor or sender)
   * @returns {Array} Pending allocation views
   */
  async fetchPendingAllocations(partyId) {
    if (!this.isReady()) return [];

    return this._withPartyContext(partyId, async () => {
      try {
        if (typeof this.sdk.tokenStandard?.fetchPendingAllocationView === 'function') {
          const allocations = await this.sdk.tokenStandard.fetchPendingAllocationView();
          console.log(`[CantonSDK] Found ${allocations?.length || 0} pending allocations for ${partyId.substring(0, 30)}...`);
          return allocations || [];
        }
        return [];
      } catch (error) {
        console.warn(`[CantonSDK] fetchPendingAllocations failed: ${error.message}`);
        return [];
      }
    });
  }

  /**
   * Execute an Allocation — exchange acts as executor.
   * 
   * Called at MATCH TIME. The exchange (executor) settles the allocation,
   * transferring funds from sender to receiver. NO user key needed.
   * 
   * CRITICAL: The Splice AmuletAllocation contract has TWO signatories:
   *   1. The operator (executor)
   *   2. The allocation owner (the wallet user who locked the tokens)
   * BOTH must be in actAs, otherwise Canton returns DAML_AUTHORIZATION_ERROR.
   * 
   * @param {string} allocationContractId - The Allocation contract ID
   * @param {string} executorPartyId - The exchange party (executor)
   * @param {string} symbol - Symbol for routing (splice vs utilities)
   * @param {string} ownerPartyId - The allocation owner (user who locked tokens) — REQUIRED for authorization
   * @returns {Object} Exercise result
   */
  async executeAllocation(allocationContractId, executorPartyId, symbol = null, ownerPartyId = null, receiverPartyId = null) {
    if (!allocationContractId) {
      console.warn('[CantonSDK] No allocationContractId — skipping execution');
      return null;
    }

    // Build the actAs list: MUST include ALL THREE parties:
    //   1. executorPartyId  — the exchange (settlement executor)
    //   2. ownerPartyId     — the sender (allocation owner, whose funds are locked)
    //   3. receiverPartyId  — the receiver (who will receive the funds)
    //
    // The AmuletAllocation / DvpLegAllocation contract requires ALL THREE as
    // authorizers for Allocation_ExecuteTransfer. Missing ANY party causes:
    //   DAML_AUTHORIZATION_ERROR: requires authorizers [executor, sender, receiver]
    const actAsParties = [executorPartyId];
    if (ownerPartyId && ownerPartyId !== executorPartyId) {
      actAsParties.push(ownerPartyId);
    }
    if (receiverPartyId && !actAsParties.includes(receiverPartyId)) {
      actAsParties.push(receiverPartyId);
    }
    const readAsParties = [...actAsParties];

    // Get synchronizerId from config — REQUIRED for all Canton command submissions
    const configModule = require('../config');
    const synchronizerId = configModule.canton.synchronizerId;

    console.log(`[CantonSDK] ✅ Executing Allocation: ${allocationContractId.substring(0, 30)}...`);
    console.log(`[CantonSDK]    Executor: ${executorPartyId.substring(0, 30)}...`);
    console.log(`[CantonSDK]    Owner/Sender: ${ownerPartyId ? ownerPartyId.substring(0, 30) + '...' : 'N/A'}`);
    console.log(`[CantonSDK]    Receiver: ${receiverPartyId ? receiverPartyId.substring(0, 30) + '...' : 'N/A'}`);
    console.log(`[CantonSDK]    actAs (${actAsParties.length} parties): [${actAsParties.map(p => p.substring(0, 20) + '...').join(', ')}]`);

    const tokenSystemType = symbol ? getTokenSystemType(symbol) : null;
    const adminToken = await tokenProvider.getServiceToken();

    // ── Route Utilities tokens (CBTC) directly to Utilities API ──────────
    // The SDK's exerciseAllocationChoice looks for AmuletAllocation (Splice-specific).
    // Utilities tokens use a DIFFERENT allocation contract type that the SDK
    // will NEVER find, resulting in "AmuletAllocation '...' not found" every time.
    // Skip the SDK entirely for Utilities tokens — go straight to the API.
    if (tokenSystemType === 'utilities') {
      console.log(`[CantonSDK]    ${symbol} is a Utilities token — using Utilities API directly (not SDK)`);
      return this._executeUtilitiesAllocation(allocationContractId, executorPartyId, symbol, adminToken, ownerPartyId, receiverPartyId);
    }

    // ── Splice tokens (CC/Amulet): Try SDK method first ──────────────────
    if (this.isReady()) {
      try {
        if (this.sdk.tokenStandard && typeof this.sdk.tokenStandard.exerciseAllocationChoice === 'function') {
          return await this._withPartyContext(executorPartyId, async () => {
            const [executeCmd, disclosed] = await this.sdk.tokenStandard.exerciseAllocationChoice(
              allocationContractId,
              'ExecuteTransfer'
            );

            const commands = Array.isArray(executeCmd) ? executeCmd : [executeCmd];
            let result = null;
            for (const rawCmd of commands) {
              const cmd = rawCmd.ExerciseCommand || rawCmd;
              result = await cantonService.exerciseChoice({
                token: adminToken,
                actAsParty: actAsParties,
                templateId: cmd.templateId,
                contractId: cmd.contractId,
                choice: cmd.choice,
                choiceArgument: cmd.choiceArgument,
                readAs: readAsParties,
                synchronizerId,
                disclosedContracts: (disclosed || []).map(dc => ({
                  templateId: dc.templateId,
                  contractId: dc.contractId,
                  createdEventBlob: dc.createdEventBlob,
                  synchronizerId: dc.synchronizerId || synchronizerId,
                })),
              });
            }

            console.log(`[CantonSDK]    ✅ Allocation executed via SDK — updateId: ${result?.transaction?.updateId || 'N/A'}`);
            return result;
          });
        }
      } catch (sdkErr) {
        console.warn(`[CantonSDK]    SDK exerciseAllocationChoice failed: ${sdkErr.message} — trying registry API`);
      }
    } else {
      console.warn(`[CantonSDK]    SDK not ready — attempting registry API execution for allocation`);
    }

    // Fallback for Splice: Try the Scan Proxy execute-transfer endpoint directly
    try {
      const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
      const encodedCid = encodeURIComponent(allocationContractId);
      const executeContextUrl = `${registryUrl}/registry/allocations/v1/${encodedCid}/choice-contexts/execute-transfer`;

      console.log(`[CantonSDK]    Trying Splice registry execute-transfer API...`);
      const resp = await fetch(executeContextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeDebugFields: true }),
      });

      if (resp.ok) {
        const context = await resp.json();
        const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation';
        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: actAsParties,
          templateId: ALLOCATION_INTERFACE,
          contractId: allocationContractId,
          choice: 'Allocation_ExecuteTransfer',
          choiceArgument: {
            extraArgs: {
              context: context.choiceContextData || { values: {} },
              meta: { values: {} },
            },
          },
          readAs: readAsParties,
          synchronizerId,
          disclosedContracts: (context.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          })),
        });

        console.log(`[CantonSDK]    ✅ Splice allocation executed via registry API — updateId: ${result?.transaction?.updateId || 'N/A'}`);
        return result;
      } else {
        const errText = await resp.text();
        console.warn(`[CantonSDK]    ⚠️ Registry execute-transfer returned ${resp.status}: ${errText.substring(0, 200)}`);
      }
    } catch (registryErr) {
      console.warn(`[CantonSDK]    ⚠️ Splice registry execute-transfer failed: ${registryErr.message}`);
    }

    // Allocation execution failed
    console.error(`[CantonSDK]    ❌ Splice allocation execution failed — all methods exhausted`);
    return null;
  }

  /**
   * Execute Utilities allocation via backend API.
   * 
   * CRITICAL: Must include both executor AND owner in actAs (dual signatory).
   * CRITICAL: Must include synchronizerId in command body.
   */
  async _executeUtilitiesAllocation(allocationContractId, executorPartyId, symbol, adminToken, ownerPartyId = null, receiverPartyId = null) {
    const adminParty = getInstrumentAdmin(symbol);
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const encodedCid = encodeURIComponent(allocationContractId);
    const executeContextUrl = `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/allocations/v1/${encodedCid}/choice-contexts/execute-transfer`;

    // Build actAs: ALL THREE parties required — executor, sender (owner), AND receiver
    // The DvpLegAllocation contract requires all three as authorizers for ExecuteTransfer
    const actAsParties = [executorPartyId];
    if (ownerPartyId && ownerPartyId !== executorPartyId) {
      actAsParties.push(ownerPartyId);
    }
    if (receiverPartyId && !actAsParties.includes(receiverPartyId)) {
      actAsParties.push(receiverPartyId);
    }
    const readAsParties = [...actAsParties];

    // Get synchronizerId — REQUIRED for Canton command submission
    const configModule = require('../config');
    const synchronizerId = configModule.canton.synchronizerId;

    try {
      console.log(`[CantonSDK]    📤 Calling Utilities execute-transfer API: ${executeContextUrl}`);
      const resp = await fetch(executeContextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[CantonSDK]    ⚠️ Utilities execute-transfer API returned ${resp.status}: ${errText.substring(0, 200)}`);
        console.error(`[CantonSDK]    ❌ Utilities allocation execution failed — API error`);
        return null;
      }

      const context = await resp.json();
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: actAsParties,
        templateId: UTILITIES_CONFIG.ALLOCATION_INTERFACE,
        contractId: allocationContractId,
        choice: 'Allocation_ExecuteTransfer',
        choiceArgument: {
          extraArgs: {
            context: context.choiceContextData || { values: {} },
            meta: { values: {} },
          },
        },
        readAs: readAsParties,
        synchronizerId,
        // CRITICAL: Every disclosed contract MUST have synchronizerId.
        // The Utilities Backend API may return some contracts (e.g., FeaturedAppRight)
        // WITHOUT synchronizerId. Backfill with command-level synchronizerId.
        disclosedContracts: (context.disclosedContracts || []).map(dc => ({
          templateId: dc.templateId,
          contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob,
          synchronizerId: dc.synchronizerId || synchronizerId,
        })),
      });

      console.log(`[CantonSDK]    ✅ Utilities allocation executed — updateId: ${result?.transaction?.updateId || 'N/A'}`);
      return result;
    } catch (err) {
      console.warn(`[CantonSDK]    ⚠️ Utilities allocation execution failed: ${err.message}`);
    }

    // Utilities allocation execution failed
    console.error(`[CantonSDK]    ❌ Utilities allocation execution failed — all methods exhausted`);
    return null;
  }

  // NOTE: _executeDirectAllocation (AllocationRecord fallback) has been REMOVED.
  // Settlement uses Allocation_ExecuteTransfer (preferred) or Transfer API (fallback).

  /**
   * Cancel an Allocation — release locked funds back to sender.
   * 
   * Called when an order is cancelled. Requires sender + executor authorization.
   * The exchange (as executor) can cancel on behalf of the user.
   * 
   * @param {string} allocationContractId - The Allocation contract ID
   * @param {string} senderPartyId - The order placer (funds returned to)
   * @param {string} executorPartyId - The exchange party
   * @param {string} symbol - Symbol for routing
   * @returns {Object} Exercise result
   */
  async cancelAllocation(allocationContractId, senderPartyId, executorPartyId, symbol = null) {
    if (!allocationContractId) {
      console.log('[CantonSDK] No allocationContractId — skipping cancellation');
      return null;
    }

    console.log(`[CantonSDK] 🔓 Cancelling Allocation: ${allocationContractId.substring(0, 30)}...`);

    const adminToken = await tokenProvider.getServiceToken();
    const configRef = require('../config');
    const operatorPartyId = configRef.canton.operatorPartyId;
    const synchronizerId = configRef.canton.synchronizerId;
    const tokenSystemType = symbol ? getTokenSystemType(symbol) : null;

    // ALL parties needed for cancel authorization
    const actAsParties = [...new Set([senderPartyId, executorPartyId, operatorPartyId].filter(Boolean))];
    const readAsParties = [...actAsParties];

    // ── Route Utilities tokens (CBTC) to Utilities cancel API ──────────
    if (tokenSystemType === 'utilities') {
      console.log(`[CantonSDK]    ${symbol} is a Utilities token — using Utilities cancel API`);
      return this._cancelUtilitiesAllocation(allocationContractId, senderPartyId, executorPartyId, symbol, adminToken);
    }

    // ── Splice tokens (CC/Amulet): Try SDK method first ──────────────
    if (this.isReady()) {
      try {
        if (this.sdk.tokenStandard && typeof this.sdk.tokenStandard.exerciseAllocationChoice === 'function') {
          return await this._withPartyContext(senderPartyId, async () => {
            const [cancelCmd, disclosed] = await this.sdk.tokenStandard.exerciseAllocationChoice(
              allocationContractId,
              'Cancel'
            );
            const commands = Array.isArray(cancelCmd) ? cancelCmd : [cancelCmd];
            let result = null;
            for (const rawCmd of commands) {
              const cmd = rawCmd.ExerciseCommand || rawCmd;
              result = await cantonService.exerciseChoice({
                token: adminToken,
                actAsParty: actAsParties,
                templateId: cmd.templateId,
                contractId: cmd.contractId,
                choice: cmd.choice,
                choiceArgument: cmd.choiceArgument,
                readAs: readAsParties,
                synchronizerId,
                disclosedContracts: (disclosed || []).map(dc => ({
                  templateId: dc.templateId,
                  contractId: dc.contractId,
                  createdEventBlob: dc.createdEventBlob,
                  synchronizerId: dc.synchronizerId || synchronizerId,
                })),
              });
            }
            console.log(`[CantonSDK]    ✅ Allocation cancelled via SDK — funds released`);
            return result;
          });
        }
      } catch (sdkErr) {
        console.warn(`[CantonSDK]    SDK cancelAllocation failed: ${sdkErr.message} — trying registry cancel API`);
      }
    } else {
      console.warn(`[CantonSDK]    SDK not ready — attempting registry cancel API for allocation`);
    }

    // ── Splice direct cancel via registry cancel-context endpoint ──────
    try {
      const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
      const encodedCid = encodeURIComponent(allocationContractId);
      const cancelContextUrl = `${registryUrl}/registry/allocations/v1/${encodedCid}/choice-contexts/cancel`;

      console.log(`[CantonSDK]    Trying Splice registry cancel API: ${cancelContextUrl}`);
      const resp = await fetch(cancelContextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeDebugFields: true }),
      });

      if (resp.ok) {
        const context = await resp.json();
        const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation';
        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: actAsParties,
          templateId: ALLOCATION_INTERFACE,
          contractId: allocationContractId,
          choice: 'Allocation_Cancel',
          choiceArgument: {
            extraArgs: {
              context: context.choiceContextData || { values: {} },
              meta: { values: {} },
            },
          },
          readAs: readAsParties,
          synchronizerId,
          disclosedContracts: (context.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          })),
        });

        console.log(`[CantonSDK]    ✅ Allocation cancelled via registry API — funds released`);
        return result;
      } else {
        const errText = await resp.text();
        console.warn(`[CantonSDK]    ⚠️ Registry cancel API returned ${resp.status}: ${errText.substring(0, 200)}`);
      }
    } catch (registryErr) {
      console.warn(`[CantonSDK]    ⚠️ Splice registry cancel failed: ${registryErr.message}`);
    }

    // Last resort: direct exercise with extraArgs (required by Splice API)
    try {
      const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation';
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: actAsParties,
        templateId: ALLOCATION_INTERFACE,
        contractId: allocationContractId,
        choice: 'Allocation_Cancel',
        choiceArgument: {
          extraArgs: {
            context: { values: {} },
            meta: { values: {} },
          },
        },
        readAs: readAsParties,
        synchronizerId,
      });

      console.log(`[CantonSDK]    ✅ Allocation cancelled (direct) — funds released`);
      return result;
    } catch (err) {
      console.warn(`[CantonSDK]    ⚠️ Direct allocation cancel failed: ${err.message}`);
    }

    console.warn(`[CantonSDK]    ⚠️ Could not cancel allocation ${allocationContractId.substring(0, 30)}... — may already be cancelled`);
    return null;
  }

  /**
   * Cancel a Utilities token allocation (CBTC) via Utilities registry cancel API.
   */
  async _cancelUtilitiesAllocation(allocationContractId, senderPartyId, executorPartyId, symbol, adminToken) {
    const adminParty = getInstrumentAdmin(symbol);
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const encodedCid = encodeURIComponent(allocationContractId);
    const cancelContextUrl = `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/allocations/v1/${encodedCid}/choice-contexts/cancel`;

    const configRef = require('../config');
    const operatorPartyId = configRef.canton.operatorPartyId;
    const synchronizerId = configRef.canton.synchronizerId;

    const actAsParties = [...new Set([senderPartyId, executorPartyId, operatorPartyId].filter(Boolean))];
    const readAsParties = [...actAsParties];

    try {
      console.log(`[CantonSDK]    📤 Calling Utilities cancel API: ${cancelContextUrl}`);
      const resp = await fetch(cancelContextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[CantonSDK]    ⚠️ Utilities cancel API returned ${resp.status}: ${errText.substring(0, 200)}`);
        // Fall through to direct exercise below
      } else {
        const context = await resp.json();
        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: actAsParties,
          templateId: UTILITIES_CONFIG.ALLOCATION_INTERFACE,
          contractId: allocationContractId,
          choice: 'Allocation_Cancel',
          choiceArgument: {
            extraArgs: {
              context: context.choiceContextData || { values: {} },
              meta: { values: {} },
            },
          },
          readAs: readAsParties,
          synchronizerId,
          disclosedContracts: (context.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          })),
        });

        console.log(`[CantonSDK]    ✅ Utilities allocation cancelled — funds released`);
        return result;
      }
    } catch (err) {
      console.warn(`[CantonSDK]    ⚠️ Utilities cancel API failed: ${err.message}`);
    }

    // Direct exercise with extraArgs
    try {
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: actAsParties,
        templateId: UTILITIES_CONFIG.ALLOCATION_INTERFACE,
        contractId: allocationContractId,
        choice: 'Allocation_Cancel',
        choiceArgument: {
          extraArgs: {
            context: { values: {} },
            meta: { values: {} },
          },
        },
        readAs: readAsParties,
        synchronizerId,
      });

      console.log(`[CantonSDK]    ✅ Utilities allocation cancelled (direct) — funds released`);
      return result;
    } catch (err) {
      console.warn(`[CantonSDK]    ⚠️ Direct Utilities cancel failed: ${err.message}`);
    }

    console.warn(`[CantonSDK]    ⚠️ Could not cancel Utilities allocation ${allocationContractId.substring(0, 30)}... — may already be cancelled`);
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOLDING TRANSACTIONS — History
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get holding transactions (token transfer history)
   */
  async getHoldingTransactions(partyId, startOffset = 0, limit = 100) {
    if (!this.isReady()) {
      return [];
    }

    return this._withPartyContext(partyId, async () => {
      try {
        const transactions = await this.sdk.tokenStandard?.listHoldingTransactions(startOffset, limit) || [];
        return transactions;
      } catch (error) {
        console.error(`[CantonSDK] Failed to get holding transactions:`, error.message);
        return [];
      }
    });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let cantonSDKClient = null;

function getCantonSDKClient() {
  if (!cantonSDKClient) {
    cantonSDKClient = new CantonSDKClient();
  }
  return cantonSDKClient;
}

module.exports = {
  CantonSDKClient,
  getCantonSDKClient,
};
