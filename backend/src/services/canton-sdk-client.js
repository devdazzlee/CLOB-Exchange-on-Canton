/**
 * Canton Wallet SDK Client
 * 
 * Wraps the official @canton-network/wallet-sdk for the CLOB Exchange.
 * 
 * Provides:
 * - Balance queries via listHoldingUtxos (UTXO-based)
 * - 2-step transfer flow: createTransfer → accept
 * - Transfer withdrawal (for cancellations)
 * - Pending transfer listing
 * 
 * Settlement is a 2-step process:
 * 1. Sender creates transfer instruction (locks their holdings)
 * 2. Receiver accepts transfer instruction (completes transfer)
 * 
 * All operations use the Canton JSON Ledger API v2 via the SDK.
 * Auth is via Keycloak client credentials (OAuth2).
 * The SDK handles the Transfer Factory Registry at the Scan Proxy.
 * 
 * @see https://docs.digitalasset.com/integrate/devnet/token-standard/index.html
 * @see https://docs.sync.global/app_dev/token_standard/openapi/transfer_instruction.html
 */

const { CANTON_SDK_CONFIG, UTILITIES_CONFIG, toCantonInstrument, toExchangeSymbol, extractInstrumentId, getTokenSystemType, getInstrumentAdmin } = require('../config/canton-sdk.config');
const cantonService = require('./cantonService');
const tokenProvider = require('./tokenProvider');
const Decimal = require('decimal.js');

// Configure decimal precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// ─── Lazy-load SDK to avoid crashes if not installed ───────────────────────
let WalletSDKImpl = null;
let ClientCredentialOAuthController = null;
let LedgerController = null;
let TokenStandardController = null;
let ValidatorController = null;
let sdkLoadError = null;

try {
  const walletSdk = require('@canton-network/wallet-sdk');
  WalletSDKImpl = walletSdk.WalletSDKImpl;
  ClientCredentialOAuthController = walletSdk.ClientCredentialOAuthController;
  LedgerController = walletSdk.LedgerController;
  TokenStandardController = walletSdk.TokenStandardController;
  ValidatorController = walletSdk.ValidatorController;
  console.log('[CantonSDK] ✅ @canton-network/wallet-sdk loaded');
} catch (e) {
  sdkLoadError = `${e.code || 'UNKNOWN'}: ${e.message}`;
  console.error('[CantonSDK] ❌ SDK require() failed:', e.code, e.message);
  console.error('[CantonSDK] ❌ Stack:', (e.stack || '').split('\n').slice(0, 5).join('\n'));
}

// ─── SDK Client ────────────────────────────────────────────────────────────

class CantonSDKClient {
  constructor() {
    this.sdk = null;
    this.initialized = false;
    this.initError = sdkLoadError;
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

    if (!WalletSDKImpl) {
      this.initError = `SDK package not loaded: ${sdkLoadError || 'require() failed'}`;
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
      // Use the OpenID Connect discovery URL — the SDK's ClientCredentialsService
      // fetches this to discover the token_endpoint.
      // Keycloak realm URL (without .well-known) returns realm info with 'token-service'
      // but the SDK expects standard OIDC with 'token_endpoint'.
      const keycloakConfigUrl = `${keycloakBaseUrl}/realms/${keycloakRealm}/.well-known/openid-configuration`;
      const clientId = (process.env.OAUTH_CLIENT_ID || '').trim();
      const clientSecret = (process.env.OAUTH_CLIENT_SECRET || '').trim();
      const oauthScope = process.env.OAUTH_SCOPE || 'openid profile email daml_ledger_api';
      const audience = jsonApiUrl; // audience = ledger API URL

      console.log(`[CantonSDK]   Keycloak:     ${keycloakConfigUrl}`);
      console.log(`[CantonSDK]   Client ID:    ${clientId.substring(0, 8)}...`);

      // Configure SDK with proper controller factories
      this.sdk = new WalletSDKImpl().configure({
        logger: console,

        // Auth factory — OAuth2 client credentials via Keycloak
        authFactory: () => {
          return new ClientCredentialOAuthController(
            keycloakConfigUrl,   // OpenID Connect config URL (Keycloak realm)
            console,             // logger
            clientId,            // userId (OAuth client ID for user operations)
            clientSecret,        // userSecret (OAuth client secret)
            clientId,            // adminId (same client for admin)
            clientSecret,        // adminSecret (same secret for admin)
            oauthScope,          // scope
            audience             // audience
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
      // This calls authFactory() → getUserToken() → then uses the factories
      // to create LedgerController, TokenStandardController, ValidatorController
      await this.sdk.connect();
      console.log('[CantonSDK] ✅ Connected to Canton Ledger');

      // Set Transfer Factory Registry URL
      // The SDK uses this to fetch the TransferFactory and choice contexts
      // from the Scan Proxy at /registry/transfer-instruction/v1/*
      // CRITICAL: SDK expects a URL object (it calls .href internally), NOT a string
      this.sdk.tokenStandard?.setTransferFactoryRegistryUrl(new URL(registryUrl));
      console.log(`[CantonSDK] ✅ Transfer Factory Registry configured: ${registryUrl}`);

      // Discover instrument admin party (needed for createTransfer)
      try {
        this.instrumentAdminPartyId = await this.sdk.tokenStandard?.getInstrumentAdmin();
        console.log(`[CantonSDK] ✅ Instrument admin: ${this.instrumentAdminPartyId?.substring(0, 40)}...`);
      } catch (e) {
        console.warn(`[CantonSDK] ⚠️ Could not discover instrument admin via SDK: ${e.message}`);
        // Fallback 1: configured env var
        this.instrumentAdminPartyId = CANTON_SDK_CONFIG.INSTRUMENT_ADMIN_PARTY;
        // Fallback 2: discover DSO party from Scan API (Amulet instrument admin = DSO party)
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
          console.warn('[CantonSDK] ⚠️ No instrument admin configured — transfers will need it');
        }
      }

      this.initialized = true;
      console.log('[CantonSDK] ✅ SDK fully initialized and ready');
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTY CONTEXT — thread-safe sequential execution
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with a specific party context.
   * Queues operations to prevent concurrent party-context conflicts.
   * 
   * @param {string} partyId - Party to set as context
   * @param {Function} operation - Async function to execute
   * @returns {*} Result of the operation
   */
  async _withPartyContext(partyId, operation) {
    return new Promise((resolve, reject) => {
      this._operationQueue = this._operationQueue
        .catch(() => {}) // Don't let previous errors block the queue
        .then(async () => {
          try {
            if (this.currentPartyId !== partyId) {
              await this.sdk.setPartyId(partyId);
              this.currentPartyId = partyId;
              // CRITICAL: setPartyId recreates the TokenStandardController via
              // the factory, so the new controller loses its registry URL.
              // Re-set it after every context switch.
              // NOTE: SDK expects a URL object (it calls .href internally), NOT a string.
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
   * 
   * @param {string} partyId - Party to query holdings for
   * @param {boolean} includeLocked - Include holdings locked in pending transfers
   * @returns {Array} Array of holding UTXOs
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
   * Calculates from UTXOs: total (all), available (unlocked), locked (in-transfer)
   * 
   * @param {string} partyId - Party to get balance for
   * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
   * @returns {Object} { total, available, locked } as string amounts
   */
  async getBalance(partyId, symbol) {
    if (!this.isReady()) {
      console.warn(`[CantonSDK] SDK not ready — returning zero balance for ${symbol}`);
      return { total: '0', available: '0', locked: '0' };
    }

    const instrumentId = toCantonInstrument(symbol);

    return this._withPartyContext(partyId, async () => {
      try {
        // Get all holdings (including locked ones in pending transfers)
        const allHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(true) || [];
        // Get only available (unlocked) holdings
        const availableHoldings = await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];

        // Filter by instrument and sum amounts
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
   * Get all balances for a party (CC + CBTC)
   * 
   * @param {string} partyId - Party to query
   * @returns {Object} { available: {CC, CBTC}, locked: {CC, CBTC}, total: {CC, CBTC} }
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

        // Group by instrument and sum
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

        // Calculate locked = total - available
        for (const sym of Object.keys(total)) {
          const t = new Decimal(total[sym] || '0');
          const a = new Decimal(available[sym] || '0');
          locked[sym] = t.minus(a).toString();
          // Ensure available has entry
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
  // TRANSFERS — 2-step: createTransfer → accept
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a transfer instruction.
   * 
   * Step 1 of the 2-step transfer flow:
   * - Locks the sender's holdings
   * - Creates a TransferInstruction on the ledger
   * - Returns the ExerciseCommand + DisclosedContracts
   * 
   * The returned command is then submitted via cantonService.exerciseChoice
   * (which uses JWT admin auth, no private key needed).
   * 
   * @param {string} senderPartyId - Sender party
   * @param {string} receiverPartyId - Receiver party
   * @param {string} amount - Amount to transfer (as string)
   * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
   * @param {string} memo - Transfer memo/reason
   * @returns {Object} { transferInstructionId, result } or throws
   */
  async createAndSubmitTransfer(senderPartyId, receiverPartyId, amount, symbol, memo = '') {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    const instrumentId = toCantonInstrument(symbol);
    const tokenSystemType = getTokenSystemType(symbol);

    console.log(`[CantonSDK] 📤 Creating transfer: ${amount} ${symbol} (${instrumentId}, ${tokenSystemType}) from ${senderPartyId.substring(0, 30)}... → ${receiverPartyId.substring(0, 30)}...`);

    // Route to the correct transfer method based on token system type
    if (tokenSystemType === 'utilities') {
      // CBTC and other Utilities tokens use a different API
      return this._createAndSubmitUtilitiesTransfer(senderPartyId, receiverPartyId, amount, symbol, memo);
    }

    // CC (Amulet) and other Splice tokens use the SDK
    return this._createAndSubmitSpliceTransfer(senderPartyId, receiverPartyId, amount, symbol, memo);
  }

  /**
   * Create and submit a transfer for Splice tokens (CC/Amulet) via SDK.
   * Uses the SDK's createTransfer which calls the Scan Proxy Transfer Factory.
   */
  async _createAndSubmitSpliceTransfer(senderPartyId, receiverPartyId, amount, symbol, memo) {
    const instrumentId = toCantonInstrument(symbol);

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

      // Build the transfer command via SDK
      // SDK calls the Transfer Factory Registry at the Scan Proxy to get the factory + context
      const [transferCommand, disclosedContracts] = await this.sdk.tokenStandard.createTransfer(
        senderPartyId,
        receiverPartyId,
        amount,
        {
          instrumentId: instrumentId,
          instrumentAdmin: this.instrumentAdminPartyId,
        },
        holdingCids,
        memo || `exchange-settlement-${Date.now()}`
      );

      console.log(`[CantonSDK]    ✅ Transfer command created (${disclosedContracts?.length || 0} disclosed contracts)`);

      // Submit the transfer command via cantonService (uses JWT admin token)
      const adminToken = await tokenProvider.getServiceToken();

      // Handle single command or array of commands
      const commands = Array.isArray(transferCommand) ? transferCommand : [transferCommand];

      let result = null;
      for (const rawCmd of commands) {
        // SDK wraps commands as { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
        const cmd = rawCmd.ExerciseCommand || rawCmd;

        console.log(`[CantonSDK]    Submitting exercise: ${cmd.choice || 'unknown'} on ${cmd.contractId?.substring(0, 30) || 'unknown'}...`);

        result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [senderPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
          readAs: [senderPartyId, receiverPartyId],
          disclosedContracts: disclosedContracts?.map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }

      return this._extractTransferResult(result);
    });
  }

  /**
   * Create and submit a transfer for Utilities tokens (CBTC) via direct HTTP API.
   * 
   * CBTC is a CIP-0056 Utilities Token with a DIFFERENT Transfer Factory Registry:
   *   ${BACKEND}/v0/registrars/${ADMIN}/registry/transfer-instruction/v1/transfer-factory
   * 
   * Reference: https://docs.digitalasset.com/utilities/devnet/how-tos/registry/transfer/transfer.html
   */
  async _createAndSubmitUtilitiesTransfer(senderPartyId, receiverPartyId, amount, symbol, memo) {
    const instrumentId = toCantonInstrument(symbol);
    const adminParty = getInstrumentAdmin(symbol);

    if (!adminParty) {
      throw new Error(`No admin party configured for ${symbol} (${instrumentId})`);
    }

    console.log(`[CantonSDK]    Using Utilities Backend API for ${symbol} transfer`);
    console.log(`[CantonSDK]    Admin party: ${adminParty.substring(0, 40)}...`);

    // Step 1: Get sender's CBTC holdings via SDK (SDK already sees all Holding interface UTXOs)
    const holdings = await this._withPartyContext(senderPartyId, async () => {
      return await this.sdk.tokenStandard?.listHoldingUtxos(false) || [];
    });

    const holdingCids = holdings
      .filter(h => {
        const hInstrumentId = extractInstrumentId(h.interfaceViewValue?.instrumentId);
        return hInstrumentId === instrumentId;
      })
      .map(h => h.contractId);

    if (holdingCids.length === 0) {
      throw new Error(`No ${symbol} holdings found for sender ${senderPartyId.substring(0, 30)}...`);
    }

    console.log(`[CantonSDK]    Found ${holdingCids.length} ${symbol} holding UTXOs`);

    // Step 2: Call Utilities Backend API for transfer factory context
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const transferFactoryUrl = `${backendUrl}/v0/registrars/${adminParty}/registry/transfer-instruction/v1/transfer-factory`;

    const now = new Date().toISOString();
    const oneHour = new Date(Date.now() + 3600000).toISOString();

    console.log(`[CantonSDK]    Calling Utilities transfer factory: ${transferFactoryUrl.substring(0, 60)}...`);

    const factoryResponse = await fetch(transferFactoryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choiceArguments: {
          expectedAdmin: adminParty,
          transfer: {
            sender: senderPartyId,
            receiver: receiverPartyId,
            amount: amount.toString(),
            instrumentId: {
              admin: adminParty,
              id: instrumentId,
            },
            requestedAt: now,
            executeBefore: oneHour,
            inputHoldingCids: holdingCids,
            meta: {
              values: {
                'splice.lfdecentralizedtrust.org/reason': memo || 'exchange-settlement',
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

    if (!factoryResponse.ok) {
      const errorText = await factoryResponse.text();
      throw new Error(`Utilities transfer factory API failed (${factoryResponse.status}): ${errorText}`);
    }

    const factory = await factoryResponse.json();
    console.log(`[CantonSDK]    ✅ Utilities transfer factory returned — factoryId: ${factory.factoryId?.substring(0, 30) || 'N/A'}...`);

    // Step 3: Submit the transfer ExerciseCommand to Canton Ledger
    const adminToken = await tokenProvider.getServiceToken();

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: [senderPartyId],
      templateId: UTILITIES_CONFIG.TRANSFER_FACTORY_INTERFACE,
      contractId: factory.factoryId,
      choice: 'TransferFactory_Transfer',
      choiceArgument: {
        expectedAdmin: adminParty,
        transfer: {
          sender: senderPartyId,
          receiver: receiverPartyId,
          amount: amount.toString(),
          instrumentId: {
            admin: adminParty,
            id: instrumentId,
          },
          requestedAt: now,
          executeBefore: oneHour,
          inputHoldingCids: holdingCids,
          meta: {
            values: {
              'splice.lfdecentralizedtrust.org/reason': memo || 'exchange-settlement',
            },
          },
        },
        extraArgs: {
          context: factory.choiceContext?.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
      readAs: [senderPartyId, receiverPartyId],
      disclosedContracts: (factory.choiceContext?.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
      })),
    });

    console.log(`[CantonSDK]    ✅ Utilities transfer submitted — updateId: ${result?.transaction?.updateId || 'N/A'}`);
    return this._extractTransferResult(result);
  }

  /**
   * Extract TransferInstruction contract ID from exercise result.
   * Shared by both Splice and Utilities transfer flows.
   */
  _extractTransferResult(result) {
    let transferInstructionId = null;
    const events = result?.transaction?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent;
      if (created?.contractId) {
        const templateId = created.templateId || '';
        // Look for TransferInstruction or TransferOffer template
        if (typeof templateId === 'string' && 
            (templateId.includes('TransferInstruction') || templateId.includes('TransferOffer'))) {
          transferInstructionId = created.contractId;
          break;
        }
      }
    }

    if (!transferInstructionId) {
      console.log('[CantonSDK]    ℹ️ No pending TransferInstruction — transfer may have auto-completed (pre-approval)');
    } else {
      console.log(`[CantonSDK]    ✅ TransferInstruction created: ${transferInstructionId.substring(0, 30)}...`);
    }

    return {
      transferInstructionId,
      result,
      autoCompleted: !transferInstructionId,
      updateId: result?.transaction?.updateId,
    };
  }

  /**
   * Accept a transfer instruction.
   * 
   * Step 2 of the 2-step transfer flow:
   * - Exercises TransferInstruction_Accept on the TransferInstruction contract
   * - Completes the transfer: receiver gets the holdings
   * 
   * @param {string} transferInstructionId - Contract ID of the TransferInstruction
   * @param {string} receiverPartyId - The receiving party
   * @returns {Object} Canton exercise result
   */
  async acceptTransfer(transferInstructionId, receiverPartyId, symbol = null) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    if (!transferInstructionId) {
      console.log('[CantonSDK] No transferInstructionId — skipping accept (may have auto-completed)');
      return null;
    }

    console.log(`[CantonSDK] ✅ Accepting transfer: ${transferInstructionId.substring(0, 30)}... by ${receiverPartyId.substring(0, 30)}...`);

    // If symbol is provided and it's a Utilities token, use the Utilities Backend API
    const tokenSystemType = symbol ? getTokenSystemType(symbol) : null;
    if (tokenSystemType === 'utilities') {
      return this._acceptUtilitiesTransfer(transferInstructionId, receiverPartyId, symbol);
    }

    // Default: use SDK for Splice tokens (CC/Amulet)
    return this._acceptSpliceTransfer(transferInstructionId, receiverPartyId);
  }

  /**
   * Accept a Splice token transfer via SDK.
   */
  async _acceptSpliceTransfer(transferInstructionId, receiverPartyId) {
    return this._withPartyContext(receiverPartyId, async () => {
      const [acceptCommand, disclosedContracts] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
        transferInstructionId,
        'Accept'
      );

      console.log(`[CantonSDK]    Accept command created (${disclosedContracts?.length || 0} disclosed contracts)`);

      const adminToken = await tokenProvider.getServiceToken();
      const commands = Array.isArray(acceptCommand) ? acceptCommand : [acceptCommand];

      let result = null;
      for (const rawCmd of commands) {
        const cmd = rawCmd.ExerciseCommand || rawCmd;

        result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [receiverPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
          readAs: [receiverPartyId],
          disclosedContracts: disclosedContracts?.map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }

      console.log(`[CantonSDK]    ✅ Transfer accepted — updateId: ${result?.transaction?.updateId || 'N/A'}`);
      return result;
    });
  }

  /**
   * Accept a Utilities token transfer (CBTC) via direct HTTP API.
   * 
   * Uses: ${BACKEND}/v0/registrars/${ADMIN}/registry/transfer-instruction/v1/${CID}/choice-contexts/accept
   * Then submits TransferInstruction_Accept via Canton Ledger API.
   * 
   * Reference: https://docs.digitalasset.com/utilities/devnet/how-tos/registry/transfer/transfer.html
   */
  async _acceptUtilitiesTransfer(transferInstructionId, receiverPartyId, symbol) {
    const adminParty = getInstrumentAdmin(symbol);
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const encodedCid = encodeURIComponent(transferInstructionId);

    console.log(`[CantonSDK]    Using Utilities Backend API for ${symbol} accept`);

    // Try multiple URL patterns for the accept context
    const urlPatterns = [
      // Pattern 1: Token Standard API (client-provided URL)
      `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
      // Pattern 2: Without URL-encoding the admin party
      `${backendUrl}/v0/registrars/${adminParty}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
      // Pattern 3: Scan Proxy / Validator registry endpoint  
      `${CANTON_SDK_CONFIG.SCAN_PROXY_URL}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
      // Pattern 4: Validator API accept endpoint
      `${CANTON_SDK_CONFIG.VALIDATOR_API_URL}/v0/wallet/transfer-offers/${encodedCid}/accept`,
    ];

    let contextResponse = null;
    let acceptContextUrl = null;
    
    for (const url of urlPatterns) {
      try {
        console.log(`[CantonSDK]    Trying: ${url.substring(0, 120)}...`);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: {},
            excludeDebugFields: true,
          }),
        });
        
        if (resp.ok) {
          contextResponse = resp;
          acceptContextUrl = url;
          console.log(`[CantonSDK]    ✅ Got response from: ${url.substring(0, 80)}...`);
          break;
        } else {
          const errorText = await resp.text();
          console.log(`[CantonSDK]    ❌ ${resp.status} from: ${url.substring(0, 80)}... — ${errorText.substring(0, 100)}`);
        }
      } catch (fetchErr) {
        console.log(`[CantonSDK]    ❌ Fetch error: ${fetchErr.message?.substring(0, 100)}`);
      }
    }

    if (!contextResponse) {
      throw new Error(`Utilities accept context API failed: all URL patterns returned errors`);
    }

    const acceptContext = await contextResponse.json();
    
    // If the validator API directly accepted (Pattern 4), it returns a result directly
    if (acceptContextUrl && acceptContextUrl.includes('/wallet/transfer-offers/')) {
      console.log(`[CantonSDK]    ✅ Transfer accepted directly via Validator API`);
      return acceptContext;
    }

    console.log(`[CantonSDK]    ✅ Accept context received (${acceptContext.disclosedContracts?.length || 0} disclosed contracts)`);

    // Step 2: Submit TransferInstruction_Accept to Canton Ledger
    const adminToken = await tokenProvider.getServiceToken();
    const defaultSyncId = CANTON_SDK_CONFIG.LEDGER_API_URL ? 
      (process.env.DEFAULT_SYNCHRONIZER_ID || 'global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a') : null;

    const result = await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: [receiverPartyId],
      templateId: UTILITIES_CONFIG.TRANSFER_INSTRUCTION_INTERFACE,
      contractId: transferInstructionId,
      choice: 'TransferInstruction_Accept',
      choiceArgument: {
        extraArgs: {
          context: acceptContext.choiceContextData || { values: {} },
          meta: { values: {} },
        },
      },
      readAs: [receiverPartyId],
      synchronizerId: defaultSyncId,
      disclosedContracts: (acceptContext.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId || defaultSyncId,
      })),
    });

    console.log(`[CantonSDK]    ✅ Utilities transfer accepted — updateId: ${result?.transaction?.updateId || 'N/A'}`);
    return result;
  }

  /**
   * Execute a full 2-step transfer: create + accept
   * 
   * Convenience method that does both steps atomically:
   * 1. Sender creates transfer instruction → locks holdings
   * 2. Receiver accepts transfer instruction → completes transfer
   * 
   * @param {string} senderPartyId - Sender
   * @param {string} receiverPartyId - Receiver
   * @param {string} amount - Amount as string
   * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
   * @param {string} memo - Reason/memo
   * @returns {Object} { createResult, acceptResult, autoCompleted }
   */
  async executeFullTransfer(senderPartyId, receiverPartyId, amount, symbol, memo = '') {
    // Step 1: Create transfer instruction
    const createResult = await this.createAndSubmitTransfer(
      senderPartyId, receiverPartyId, amount, symbol, memo
    );

    // Step 2: If a TransferInstruction was created, accept it
    if (createResult.autoCompleted) {
      console.log(`[CantonSDK] Transfer auto-completed (pre-approval) — no accept needed`);
      return {
        createResult,
        acceptResult: null,
        autoCompleted: true,
        updateId: createResult.updateId,
      };
    }

    // Pass symbol so acceptTransfer can route to the correct API (Splice vs Utilities)
    const acceptResult = await this.acceptTransfer(
      createResult.transferInstructionId,
      receiverPartyId,
      symbol
    );

    return {
      createResult,
      acceptResult,
      autoCompleted: false,
      updateId: acceptResult?.transaction?.updateId || createResult.updateId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER MANAGEMENT — Withdraw, Reject, List Pending
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get pending transfer instructions for a party
   * @param {string} partyId - Party to check
   * @returns {Array} Pending transfer instructions
   */
  async getPendingTransfers(partyId) {
    if (!this.isReady()) {
      return [];
    }

    return this._withPartyContext(partyId, async () => {
      try {
        const instructions = await this.sdk.tokenStandard?.fetchPendingTransferInstructionView() || [];
        console.log(`[CantonSDK] Found ${instructions.length} pending transfers for ${partyId.substring(0, 30)}...`);
        return instructions;
      } catch (error) {
        console.error(`[CantonSDK] Failed to get pending transfers:`, error.message);
        return [];
      }
    });
  }

  /**
   * Withdraw a transfer instruction (sender cancels before acceptance)
   * This unlocks the sender's holdings.
   * 
   * @param {string} transferInstructionId - Contract ID
   * @param {string} senderPartyId - The sender party
   * @returns {Object} Exercise result
   */
  async withdrawTransfer(transferInstructionId, senderPartyId) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    console.log(`[CantonSDK] 🔓 Withdrawing transfer: ${transferInstructionId.substring(0, 30)}...`);

    return this._withPartyContext(senderPartyId, async () => {
      const [withdrawCommand, disclosedContracts] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
        transferInstructionId,
        'Withdraw'
      );

      const adminToken = await tokenProvider.getServiceToken();
      const commands = Array.isArray(withdrawCommand) ? withdrawCommand : [withdrawCommand];

      let result = null;
      for (const rawCmd of commands) {
        // SDK wraps commands as { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
        const cmd = rawCmd.ExerciseCommand || rawCmd;

        result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [senderPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
          readAs: [senderPartyId],
          disclosedContracts: disclosedContracts?.map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }

      console.log(`[CantonSDK]    ✅ Transfer withdrawn — holdings unlocked`);
      return result;
    });
  }

  /**
   * Reject a transfer instruction (receiver rejects)
   * 
   * @param {string} transferInstructionId - Contract ID
   * @param {string} receiverPartyId - The receiver party
   * @returns {Object} Exercise result
   */
  async rejectTransfer(transferInstructionId, receiverPartyId) {
    if (!this.isReady()) {
      throw new Error('Canton SDK not initialized');
    }

    console.log(`[CantonSDK] ❌ Rejecting transfer: ${transferInstructionId.substring(0, 30)}...`);

    return this._withPartyContext(receiverPartyId, async () => {
      const [rejectCommand, disclosedContracts] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
        transferInstructionId,
        'Reject'
      );

      const adminToken = await tokenProvider.getServiceToken();
      const commands = Array.isArray(rejectCommand) ? rejectCommand : [rejectCommand];

      let result = null;
      for (const rawCmd of commands) {
        // SDK wraps commands as { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
        const cmd = rawCmd.ExerciseCommand || rawCmd;

        result = await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [receiverPartyId],
          templateId: cmd.templateId,
          contractId: cmd.contractId,
          choice: cmd.choice,
          choiceArgument: cmd.choiceArgument,
          readAs: [receiverPartyId],
          disclosedContracts: disclosedContracts?.map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            ...(dc.synchronizerId && { synchronizerId: dc.synchronizerId }),
          })),
        });
      }

      console.log(`[CantonSDK]    ✅ Transfer rejected`);
      return result;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOLDING TRANSACTIONS — History
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get holding transactions (token transfer history)
   * @param {string} partyId - Party to query
   * @param {number} startOffset - Start offset on ledger
   * @param {number} limit - Max transactions to return
   * @returns {Array} Transaction history
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

