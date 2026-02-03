/**
 * Configuration Module - FIXED VERSION
 * 
 * Single source of truth for all configuration.
 * NO FALLBACKS - fail fast if required values are missing.
 * 
 * Based on DEVNET configuration:
 * - JSON Ledger API: http://65.108.40.104:31539
 * - Scan Proxy: http://65.108.40.104:8088
 * - Keycloak: https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet
 */

// Import centralized constants
const {
  TOKEN_STANDARD_PACKAGE_ID,
  LEGACY_PACKAGE_ID,
  TEMPLATE_IDS,
  TRADING_PAIRS,
  SUPPORTED_TOKENS,
  DEFAULT_MINT_AMOUNTS,
  getTokenStandardTemplateIds,
  getLegacyTemplateIds,
  buildInstrumentId,
} = require('./constants');

const config = {
  // Server
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    env: process.env.NODE_ENV || 'development',
  },

  // WebSocket
  websocket: {
    path: process.env.WEBSOCKET_PATH || '/ws',
    perMessageDeflate: process.env.WEBSOCKET_PER_MESSAGE_DEFLATE !== 'false',
  },

  // Canton endpoints (NO FALLBACKS)
  canton: {
    // JSON Ledger API - PRIMARY for all reads/writes
    jsonApiBase: process.env.CANTON_JSON_LEDGER_API_BASE,

    // Admin API (gRPC) - for DAR uploads
    adminHost: process.env.CANTON_ADMIN_API_GRPC_HOST,
    adminPort: parseInt(process.env.CANTON_ADMIN_API_GRPC_PORT || '0', 10),

    // Ledger API (gRPC)
    ledgerHost: process.env.CANTON_LEDGER_API_GRPC_HOST,
    ledgerPort: parseInt(process.env.CANTON_LEDGER_API_GRPC_PORT || '0', 10),

    // Operator party
    operatorPartyId: process.env.OPERATOR_PARTY_ID,

    // Default synchronizer (REQUIRED for all commands)
    synchronizerId: process.env.DEFAULT_SYNCHRONIZER_ID,

    // Package name for template IDs (package-name format)
    packageName: process.env.PACKAGE_NAME || 'clob-exchange',

    // Package ID for template IDs (package-id format) - REQUIRED for UserAccount creation
    // Uses centralized constant from constants.js
    packageId: process.env.CLOB_EXCHANGE_PACKAGE_ID || LEGACY_PACKAGE_ID,
    
    // Token Standard Package ID (Instrument, Holding, Settlement, OrderV3)
    // Uses centralized constant from constants.js
    tokenStandardPackageId: TOKEN_STANDARD_PACKAGE_ID,

    // OAuth configuration (SERVICE TOKEN ONLY)
    oauth: {
      tokenUrl: process.env.KEYCLOAK_TOKEN_URL,
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      audience: process.env.CANTON_JSON_LEDGER_API_BASE,
      scope: process.env.OAUTH_SCOPE || 'openid profile email daml_ledger_api',
    },

    // Add packageIds for validation compatibility
    get packageIds() {
      return {
        clobExchange: this.packageId || this.packageName, // Prefer package-id format
        userAccount: this.packageId || this.packageName,  // Prefer package-id format
        tokenStandard: this.tokenStandardPackageId        // Token Standard package
      };
    },

    // Validation helper for required package ID
    validatePackageId() {
      if (!this.packageId) {
        throw new Error('CLOB_EXCHANGE_PACKAGE_ID environment variable is required for UserAccount creation. Please extract the package ID from your DAR file and set it in the environment.');
      }
      return this.packageId;
    },

    // Add oauth properties for validation compatibility
    get oauthTokenUrl() { return this.oauth.tokenUrl; },
    get oauthClientId() { return this.oauth.clientId; },
    get oauthClientSecret() { return this.oauth.clientSecret; },
  },

  // Scan API (Token Standard)
  scan: {
    proxyBase: process.env.SCAN_PROXY_BASE,
    apiPrefix: process.env.SCAN_API_PREFIX || '/api/scan',

    // Full scan URL
    get baseUrl() {
      return this.proxyBase ? `${this.proxyBase}${this.apiPrefix}` : null;
    }
  },

  // Keycloak
  keycloak: {
    baseUrl: process.env.KEYCLOAK_BASE_URL,
    realm: process.env.KEYCLOAK_REALM || 'canton-devnet',
    tokenUrl: process.env.KEYCLOAK_TOKEN_URL,
  },

  // Matching engine
  matchingEngine: {
    enabled: process.env.MATCHING_ENGINE_ENABLED !== 'false',
    intervalMs: parseInt(process.env.MATCHING_ENGINE_INTERVAL_MS || '1000', 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },

  /**
   * Validate required configuration
   * Call this at startup - fails fast if required values missing
   */
  validate() {
    const errors = [];

    // Required Canton values
    if (!this.canton.jsonApiBase) {
      errors.push('CANTON_JSON_LEDGER_API_BASE is required');
    }
    if (!this.canton.synchronizerId) {
      errors.push('DEFAULT_SYNCHRONIZER_ID is required');
    }
    if (!this.canton.operatorPartyId) {
      errors.push('OPERATOR_PARTY_ID is required');
    }

    // Required Package ID for UserAccount creation
    if (!this.canton.packageId) {
      errors.push('CLOB_EXCHANGE_PACKAGE_ID is required for UserAccount creation. Extract from DAR file and set in environment.');
    }

    // Required OAuth values
    if (!this.canton.oauth.tokenUrl) {
      errors.push('KEYCLOAK_TOKEN_URL is required');
    }
    if (!this.canton.oauth.clientId) {
      errors.push('OAUTH_CLIENT_ID is required');
    }
    if (!this.canton.oauth.clientSecret) {
      errors.push('OAUTH_CLIENT_SECRET is required');
    }

    if (errors.length > 0) {
      console.error('='.repeat(60));
      console.error('CONFIGURATION VALIDATION FAILED');
      console.error('='.repeat(60));
      errors.forEach(e => console.error(`  ✗ ${e}`));
      console.error('='.repeat(60));
      console.error('Please check your .env file');
      console.error('='.repeat(60));
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    console.log('[Config] ✓ Configuration validated successfully');
    return true;
  },

  /**
   * Get template ID in package-name format
   * @param {string} templateName - e.g., 'Order:Order', 'Trade:Trade', 'Balance:Balance'
   */
  getTemplateId(templateName) {
    return `${this.canton.packageName}:${templateName}`;
  },

  /**
   * Get configuration summary for logging (masks secrets)
   */
  getSummary() {
    const mask = (s) => s ? `${s.slice(0, 16)}...` : '(not set)';

    return {
      server: {
        port: this.server.port,
        env: this.server.env,
      },
      canton: {
        jsonApiBase: this.canton.jsonApiBase || '(not set)',
        adminHost: this.canton.adminHost || '(not set)',
        adminPort: this.canton.adminPort || '(not set)',
        operatorPartyId: mask(this.canton.operatorPartyId),
        synchronizerId: mask(this.canton.synchronizerId),
        packageName: this.canton.packageName,
        oauthConfigured: !!(this.canton.oauth.clientId && this.canton.oauth.clientSecret),
      },
      scan: {
        baseUrl: this.scan.baseUrl || '(not set)',
      },
      keycloak: {
        baseUrl: this.keycloak.baseUrl || '(not set)',
        realm: this.keycloak.realm,
      },
      matchingEngine: {
        enabled: this.matchingEngine.enabled,
        intervalMs: this.matchingEngine.intervalMs,
      },
    };
  },
};

// Re-export constants for convenience
config.constants = {
  TOKEN_STANDARD_PACKAGE_ID,
  LEGACY_PACKAGE_ID,
  TEMPLATE_IDS,
  TRADING_PAIRS,
  SUPPORTED_TOKENS,
  DEFAULT_MINT_AMOUNTS,
  getTokenStandardTemplateIds,
  getLegacyTemplateIds,
  buildInstrumentId,
};

module.exports = config;
