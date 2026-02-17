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
 * - Works for BOTH internal AND external parties
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
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    // If initialization is already in progress, await the same promise
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInitialize();
    return this._initPromise;
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
  // ALLOCATIONS — Settlement via Allocation API
  //
  // Architecture (replaces TransferInstruction):
  // 1. At ORDER PLACEMENT: User creates Allocation (exchange = executor)
  //    → Locks the user's holdings
  //    → User signs ONCE (for external parties) or backend acts as user (internal)
  // 2. At MATCH TIME: Exchange executes Allocation with its OWN key
  //    → No user key needed at settlement
  //    → Works for both internal AND external parties
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
   * Create allocation for Splice tokens (CC/Amulet) via SDK.
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

      const now = new Date().toISOString();
      const settleBefore = new Date(Date.now() + 86400000).toISOString(); // 24 hours
      const allocateBefore = new Date(Date.now() + 3600000).toISOString(); // 1 hour

      // Build allocation spec
      const allocationSpec = {
        settlement: {
          settleBefore,
          allocateBefore,
          executor: executorPartyId,
        },
        transferLegId: orderId || `leg-${Date.now()}`,
        transferLeg: {
          sender: senderPartyId,
          receiver: receiverPartyId || executorPartyId, // Use executor as receiver if counterparty unknown
          amount: amount.toString(),
          instrumentId: {
            id: instrumentId,
            admin: adminParty,
          },
        },
        inputHoldingCids: holdingCids,
        meta: {
          values: {
            'splice.lfdecentralizedtrust.org/reason': `exchange-allocation:${orderId}`,
          },
        },
      };

      // Try SDK method first, fallback to registry HTTP API
      let allocateCmd = null;
      let disclosed = null;

      try {
        if (typeof this.sdk.tokenStandard?.createAllocationInstruction === 'function') {
          console.log(`[CantonSDK]    Using SDK createAllocationInstruction...`);
          [allocateCmd, disclosed] = await this.sdk.tokenStandard.createAllocationInstruction(
            allocationSpec,
            adminParty
          );
        }
      } catch (sdkErr) {
        console.warn(`[CantonSDK]    SDK createAllocationInstruction failed: ${sdkErr.message}`);
        allocateCmd = null;
      }

      // Fallback: Use registry HTTP API (same pattern as transfer factory)
      if (!allocateCmd) {
        console.log(`[CantonSDK]    Falling back to Allocation Factory Registry API...`);
        const registryUrl = CANTON_SDK_CONFIG.REGISTRY_API_URL;
        const allocationFactoryUrl = `${registryUrl}/registry/allocation/v1/allocation-factory`;

        try {
          const factoryResponse = await fetch(allocationFactoryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              choiceArguments: {
                expectedAdmin: adminParty,
                allocation: {
                  sender: senderPartyId,
                  receiver: receiverPartyId || executorPartyId,
                  executor: executorPartyId,
                  amount: amount.toString(),
                  instrumentId: {
                    admin: adminParty,
                    id: instrumentId,
                  },
                  requestedAt: now,
                  settleBefore,
                  inputHoldingCids: holdingCids,
                  meta: {
                    values: {
                      'splice.lfdecentralizedtrust.org/reason': `exchange-allocation:${orderId}`,
                    },
                  },
                },
                extraArgs: {
                  context: { values: {} },
                  meta: { values: {} },
                },
              },
              excludeDebugFields: true,
            }),
          });

          if (factoryResponse.ok) {
            const factory = await factoryResponse.json();
            console.log(`[CantonSDK]    ✅ Allocation factory returned — factoryId: ${factory.factoryId?.substring(0, 30) || 'N/A'}...`);

            // Build exercise command from factory response
            allocateCmd = {
              templateId: UTILITIES_CONFIG.ALLOCATION_FACTORY_INTERFACE,
              contractId: factory.factoryId,
              choice: 'AllocationFactory_Allocate',
              choiceArgument: {
                expectedAdmin: adminParty,
                allocation: {
                  sender: senderPartyId,
                  receiver: receiverPartyId || executorPartyId,
                  executor: executorPartyId,
                  amount: amount.toString(),
                  instrumentId: { admin: adminParty, id: instrumentId },
                  requestedAt: now,
                  settleBefore,
                  inputHoldingCids: holdingCids,
                  meta: { values: { 'splice.lfdecentralizedtrust.org/reason': `exchange-allocation:${orderId}` } },
                },
                extraArgs: {
                  context: factory.choiceContext?.choiceContextData || { values: {} },
                  meta: { values: {} },
                },
              },
            };
            disclosed = factory.choiceContext?.disclosedContracts || [];
          } else {
            const errorText = await factoryResponse.text();
            console.warn(`[CantonSDK]    ⚠️ Allocation factory API returned ${factoryResponse.status}: ${errorText.substring(0, 200)}`);
          }
        } catch (fetchErr) {
          console.warn(`[CantonSDK]    ⚠️ Allocation factory fetch failed: ${fetchErr.message}`);
        }
      }

      // Submit the allocation command via cantonService (uses JWT admin token)
      const adminToken = await tokenProvider.getServiceToken();

      if (allocateCmd) {
        const cmd = allocateCmd.ExerciseCommand || allocateCmd;

        console.log(`[CantonSDK]    Submitting allocation: ${cmd.choice || 'AllocationFactory_Allocate'} on ${(cmd.contractId || '').substring(0, 30)}...`);

        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [senderPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
          readAs: [senderPartyId, executorPartyId],
          disclosedContracts: (disclosed || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });

        return this._extractAllocationResult(result, orderId);
      }

      // If no factory available, create allocation via direct Canton API
      console.log(`[CantonSDK]    Using direct Canton API for allocation (no factory available)...`);
      return this._createDirectAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId, holdingCids, adminToken);
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
    const allocationFactoryUrl = `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/allocation/v1/allocation-factory`;

    const now = new Date().toISOString();
    const settleBefore = new Date(Date.now() + 86400000).toISOString();

    try {
      const factoryResponse = await fetch(allocationFactoryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choiceArguments: {
          expectedAdmin: adminParty,
            allocation: {
            sender: senderPartyId,
              receiver: receiverPartyId || executorPartyId,
              executor: executorPartyId,
            amount: amount.toString(),
              instrumentId: { admin: adminParty, id: instrumentId },
            requestedAt: now,
              settleBefore,
            inputHoldingCids: holdingCids,
              meta: { values: { 'splice.lfdecentralizedtrust.org/reason': `exchange-allocation:${orderId}` } },
            },
            extraArgs: { context: { values: {} }, meta: { values: {} } },
        },
        excludeDebugFields: true,
      }),
    });

    if (!factoryResponse.ok) {
      const errorText = await factoryResponse.text();
        throw new Error(`Utilities allocation factory API failed (${factoryResponse.status}): ${errorText}`);
    }

    const factory = await factoryResponse.json();
      console.log(`[CantonSDK]    ✅ Utilities allocation factory returned`);

    const adminToken = await tokenProvider.getServiceToken();

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: [senderPartyId],
        templateId: UTILITIES_CONFIG.ALLOCATION_FACTORY_INTERFACE,
      contractId: factory.factoryId,
        choice: 'AllocationFactory_Allocate',
      choiceArgument: {
        expectedAdmin: adminParty,
          allocation: {
          sender: senderPartyId,
            receiver: receiverPartyId || executorPartyId,
            executor: executorPartyId,
          amount: amount.toString(),
            instrumentId: { admin: adminParty, id: instrumentId },
          requestedAt: now,
            settleBefore,
          inputHoldingCids: holdingCids,
            meta: { values: { 'splice.lfdecentralizedtrust.org/reason': `exchange-allocation:${orderId}` } },
        },
        extraArgs: {
          context: factory.choiceContext?.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
        readAs: [senderPartyId, executorPartyId],
      disclosedContracts: (factory.choiceContext?.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
      })),
    });

      return this._extractAllocationResult(result, orderId);
    } catch (error) {
      console.error(`[CantonSDK]    ❌ Utilities allocation failed: ${error.message}`);
      // Fallback to direct allocation
      const adminToken = await tokenProvider.getServiceToken();
      return this._createDirectAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId, holdingCids, adminToken);
    }
  }

  /**
   * Fallback: Create allocation via direct Canton API when no factory is available.
   * Uses the CLOB exchange's own Allocation template on Canton.
   */
  async _createDirectAllocation(senderPartyId, receiverPartyId, amount, symbol, executorPartyId, orderId, holdingCids, token) {
    const config = require('../config');
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;

    console.log(`[CantonSDK]    Creating direct allocation via CLOB exchange contract...`);

    // Create an AllocationRecord contract on our exchange's Canton contracts
    const result = await cantonService.createContractWithTransaction({
      token,
      actAsParty: [senderPartyId, operatorPartyId],
      templateId: `${packageId}:Settlement:AllocationRecord`,
      createArguments: {
        allocationId: `alloc-${orderId}`,
        orderId: orderId,
        sender: senderPartyId,
        receiver: receiverPartyId || '',
        executor: executorPartyId,
        amount: amount.toString(),
        instrument: symbol,
        holdingCids: holdingCids || [],
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        operator: operatorPartyId,
      },
      readAs: [operatorPartyId, senderPartyId],
      synchronizerId,
    });

    let allocationContractId = null;
    const events = result?.transaction?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent;
      if (created?.contractId) {
        allocationContractId = created.contractId;
        break;
      }
    }

    console.log(`[CantonSDK]    ✅ Direct allocation created: ${allocationContractId?.substring(0, 30) || 'N/A'}...`);

    return {
      allocationContractId: allocationContractId || `alloc-${orderId}`,
      result,
      orderId,
      updateId: result?.transaction?.updateId,
    };
  }

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
   * @param {string} allocationContractId - The Allocation contract ID
   * @param {string} executorPartyId - The exchange party (executor)
   * @param {string} symbol - Symbol for routing (splice vs utilities)
   * @returns {Object} Exercise result
   */
  async executeAllocation(allocationContractId, executorPartyId, symbol = null) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    if (!allocationContractId) {
      console.warn('[CantonSDK] No allocationContractId — skipping execution');
      return null;
    }

    console.log(`[CantonSDK] ✅ Executing Allocation: ${allocationContractId.substring(0, 30)}... by executor ${executorPartyId.substring(0, 30)}...`);

    const tokenSystemType = symbol ? getTokenSystemType(symbol) : null;
      const adminToken = await tokenProvider.getServiceToken();

    // Try SDK method first
    try {
      if (this.sdk.tokenStandard && typeof this.sdk.tokenStandard.exerciseAllocationChoice === 'function') {
        return await this._withPartyContext(executorPartyId, async () => {
          const [executeCmd, disclosed] = await this.sdk.tokenStandard.exerciseAllocationChoice(
            allocationContractId,
            'Execute'
          );

          const commands = Array.isArray(executeCmd) ? executeCmd : [executeCmd];
      let result = null;
      for (const rawCmd of commands) {
        const cmd = rawCmd.ExerciseCommand || rawCmd;
        result = await cantonService.exerciseChoice({
          token: adminToken,
              actAsParty: [executorPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
              readAs: [executorPartyId],
              disclosedContracts: (disclosed || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }

          console.log(`[CantonSDK]    ✅ Allocation executed via SDK — updateId: ${result?.transaction?.updateId || 'N/A'}`);
      return result;
    });
      }
    } catch (sdkErr) {
      console.warn(`[CantonSDK]    SDK exerciseAllocationChoice failed: ${sdkErr.message} — trying direct API`);
    }

    // Fallback: Try registry API for execution context
    if (tokenSystemType === 'utilities') {
      return this._executeUtilitiesAllocation(allocationContractId, executorPartyId, symbol, adminToken);
    }

    // Default: Try direct exercise on the Allocation contract
    return this._executeDirectAllocation(allocationContractId, executorPartyId, adminToken);
  }

  /**
   * Execute Utilities allocation via backend API.
   */
  async _executeUtilitiesAllocation(allocationContractId, executorPartyId, symbol, adminToken) {
    const adminParty = getInstrumentAdmin(symbol);
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const encodedCid = encodeURIComponent(allocationContractId);
    const executeContextUrl = `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/allocation/v1/${encodedCid}/choice-contexts/execute`;

    try {
      const resp = await fetch(executeContextUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
        });
        
        if (resp.ok) {
        const context = await resp.json();
    const result = await cantonService.exerciseChoice({
      token: adminToken,
          actAsParty: [executorPartyId],
          templateId: UTILITIES_CONFIG.ALLOCATION_INTERFACE,
          contractId: allocationContractId,
          choice: 'Allocation_Execute',
      choiceArgument: {
        extraArgs: {
              context: context.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
          readAs: [executorPartyId],
          disclosedContracts: (context.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
      })),
    });

        console.log(`[CantonSDK]    ✅ Utilities allocation executed — updateId: ${result?.transaction?.updateId || 'N/A'}`);
    return result;
  }
    } catch (err) {
      console.warn(`[CantonSDK]    ⚠️ Utilities allocation execute context failed: ${err.message}`);
    }

    // Final fallback
    return this._executeDirectAllocation(allocationContractId, executorPartyId, adminToken);
  }

  /**
   * Execute allocation via direct Canton API exercise.
   */
  async _executeDirectAllocation(allocationContractId, executorPartyId, adminToken) {
    const config = require('../config');
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    // Try Splice Token Standard Allocation interface first
    const templateIdsToTry = [
      UTILITIES_CONFIG.ALLOCATION_INTERFACE,
      `${packageId}:Settlement:AllocationRecord`,
    ];

    for (const templateId of templateIdsToTry) {
      try {
        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [executorPartyId, operatorPartyId],
          templateId,
          contractId: allocationContractId,
          choice: templateId.includes('AllocationRecord') ? 'ExecuteAllocation' : 'Allocation_Execute',
          choiceArgument: {},
          readAs: [executorPartyId, operatorPartyId],
        });

        console.log(`[CantonSDK]    ✅ Allocation executed (direct) — updateId: ${result?.transaction?.updateId || 'N/A'}`);
        return result;
      } catch (err) {
        console.warn(`[CantonSDK]    ⚠️ Direct allocation execute failed with ${templateId}: ${err.message}`);
        continue;
      }
    }

    throw new Error(`Failed to execute allocation ${allocationContractId.substring(0, 30)}... — all methods exhausted`);
  }

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
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    if (!allocationContractId) {
      console.log('[CantonSDK] No allocationContractId — skipping cancellation');
      return null;
    }

    console.log(`[CantonSDK] 🔓 Cancelling Allocation: ${allocationContractId.substring(0, 30)}...`);

      const adminToken = await tokenProvider.getServiceToken();
    const config = require('../config');
    const packageId = config.canton.packageIds.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;

    // Try SDK method first
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
              actAsParty: [senderPartyId, executorPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
              readAs: [senderPartyId, executorPartyId],
              disclosedContracts: (disclosed || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }
          console.log(`[CantonSDK]    ✅ Allocation cancelled via SDK — funds released`);
      return result;
    });
  }
    } catch (sdkErr) {
      console.warn(`[CantonSDK]    SDK cancelAllocation failed: ${sdkErr.message} — trying direct API`);
    }

    // Fallback: direct exercise
    const templateIdsToTry = [
      UTILITIES_CONFIG.ALLOCATION_INTERFACE,
      `${packageId}:Settlement:AllocationRecord`,
    ];

    for (const templateId of templateIdsToTry) {
      try {
        const result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [senderPartyId, executorPartyId, operatorPartyId],
          templateId,
          contractId: allocationContractId,
          choice: templateId.includes('AllocationRecord') ? 'CancelAllocation' : 'Allocation_Cancel',
          choiceArgument: {},
          readAs: [senderPartyId, executorPartyId, operatorPartyId],
        });

        console.log(`[CantonSDK]    ✅ Allocation cancelled (direct) — funds released`);
      return result;
      } catch (err) {
        console.warn(`[CantonSDK]    ⚠️ Direct allocation cancel failed with ${templateId}: ${err.message}`);
        continue;
      }
    }

    console.warn(`[CantonSDK]    ⚠️ Could not cancel allocation ${allocationContractId.substring(0, 30)}... — may already be cancelled`);
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
