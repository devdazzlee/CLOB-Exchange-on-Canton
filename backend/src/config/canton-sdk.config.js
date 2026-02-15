/**
 * Canton Wallet SDK Configuration
 * 
 * Configures the SDK to connect to the WolfEdge DevNet Canton validator
 * and access the Splice Token Standard APIs.
 * 
 * Key endpoints:
 * - JSON Ledger API: For reading/writing contracts
 * - Scan Proxy: For Transfer Factory Registry (transfer instructions)
 * - Keycloak: For JWT authentication
 */

require('dotenv').config();

const SCAN_PROXY_BASE = process.env.SCAN_PROXY_BASE || 'http://65.108.40.104:8088';

const CANTON_SDK_CONFIG = {
  // JSON Ledger API — primary for all reads/writes
  LEDGER_API_URL: process.env.CANTON_JSON_LEDGER_API_BASE || 'http://65.108.40.104:31539',

  // Scan Proxy — serves the Transfer Factory Registry API
  // Route: /registry/transfer-instruction/v1/transfer-factory
  // Also exposes: /api/scan/v0/* for Amulet and other lookups
  SCAN_PROXY_URL: SCAN_PROXY_BASE,

  // Validator API URL — used by SDK's ValidatorController and TokenStandardController
  // The SDK TokenStandardController takes this as its "base" URL
  VALIDATOR_API_URL: process.env.VALIDATOR_API_URL || `${SCAN_PROXY_BASE}/api/validator`,

  // Registry API URL — the Scan Proxy path used by SDK's setTransferFactoryRegistryUrl()
  // This is where the Transfer Factory Registry API lives
  REGISTRY_API_URL: process.env.REGISTRY_API_URL || `${SCAN_PROXY_BASE}/api/validator/v0/scan-proxy`,

  // Scan API URL — used by SDK's TokenStandardController for scan-based lookups
  SCAN_API_URL: process.env.SCAN_API_URL || `${SCAN_PROXY_BASE}/api/scan`,

  // Instrument admin party — discovered at runtime via sdk.tokenStandard.getInstrumentAdmin()
  // Set this env var to skip discovery
  INSTRUMENT_ADMIN_PARTY: process.env.INSTRUMENT_ADMIN_PARTY || null,

  // Operator party — the exchange service account
  OPERATOR_PARTY_ID: process.env.OPERATOR_PARTY_ID,

  // ─── Instrument mapping ────────────────────────────────────────────────────
  // Canton uses "Amulet" as the instrumentId for CC (Canton Coin).
  // CBTC is "CBTC" (no mapping needed).
  // This maps exchange symbols → Canton instrument IDs.
  INSTRUMENT_MAP: {
    'CC': 'Amulet',
    'CBTC': 'CBTC',
    'Amulet': 'Amulet',
    'BTC': 'BTC',
    'USDT': 'USDT',
    'ETH': 'ETH',
    'SOL': 'SOL',
  },

  // Reverse map: Canton instrument ID → exchange symbol
  REVERSE_INSTRUMENT_MAP: {
    'Amulet': 'CC',
    'CBTC': 'CBTC',
    'BTC': 'BTC',
    'USDT': 'USDT',
    'ETH': 'ETH',
    'SOL': 'SOL',
  },

  // Trading pairs
  TRADING_PAIRS: {
    'CC/CBTC': {
      base: 'CC',
      quote: 'CBTC',
      baseInstrument: 'Amulet',  // CC = Amulet in Canton
      quoteInstrument: 'CBTC',
    },
    'BTC/USDT': {
      base: 'BTC',
      quote: 'USDT',
      baseInstrument: 'BTC',
      quoteInstrument: 'USDT',
    },
  },
};

/**
 * Map exchange symbol to Canton instrument ID (always returns a string).
 * @param {string} symbol - Exchange symbol (e.g., 'CC', 'CBTC')
 * @returns {string} Canton instrument ID (e.g., 'Amulet', 'CBTC')
 */
function toCantonInstrument(symbol) {
  return CANTON_SDK_CONFIG.INSTRUMENT_MAP[symbol] || String(symbol);
}

/**
 * Extract the instrument-ID string from the SDK's instrumentId field,
 * which may be a plain string ("Amulet") or an object ({ admin, id }).
 * @param {string|Object} instrumentIdField - Raw instrumentId from UTXO
 * @returns {string} The plain instrument-ID string
 */
function extractInstrumentId(instrumentIdField) {
  if (!instrumentIdField) return '';
  if (typeof instrumentIdField === 'string') return instrumentIdField;
  if (typeof instrumentIdField === 'object') return instrumentIdField.id || '';
  return String(instrumentIdField);
}

/**
 * Map Canton instrument ID to exchange symbol.
 * Handles both string ("Amulet") and object ({ admin: "...", id: "Amulet" }) formats.
 * @param {string|Object} instrumentId - Canton instrument ID
 * @returns {string} Exchange symbol (e.g., 'CC')
 */
function toExchangeSymbol(instrumentId) {
  // SDK returns instrumentId as { admin, id } object — extract the .id string
  const id = (typeof instrumentId === 'object' && instrumentId !== null)
    ? (instrumentId.id || instrumentId)
    : instrumentId;
  return CANTON_SDK_CONFIG.REVERSE_INSTRUMENT_MAP[id] || String(id);
}

module.exports = {
  CANTON_SDK_CONFIG,
  toCantonInstrument,
  toExchangeSymbol,
  extractInstrumentId,
};

