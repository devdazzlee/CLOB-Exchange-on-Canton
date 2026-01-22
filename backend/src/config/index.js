/**
 * Application Configuration
 * Centralized configuration management
 */

require('dotenv').config();

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3001,
    env: process.env.NODE_ENV || 'development',
  },

  // Canton Configuration
  canton: {
    jsonApiBase: process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539',
    operatorPartyId: process.env.OPERATOR_PARTY_ID ||
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292',
    // OAuth configuration for Canton JSON API
    oauthTokenUrl: process.env.CANTON_OAUTH_TOKEN_URL ||
      'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    oauthClientId: process.env.CANTON_OAUTH_CLIENT_ID ||
      'Sesnp3u6udkFF983rfprvsBbx3X3mBpw',
    oauthClientSecret: process.env.CANTON_OAUTH_CLIENT_SECRET || '',
    // Optional synchronizer ID override (will be discovered if not set)
    synchronizerId: process.env.CANTON_SYNCHRONIZER_ID || null,
    // Package IDs - NEW DAR uploaded 2026-01-22 with all features
    // The system auto-discovers package IDs, these are fallbacks
    packageIds: {
      // NEW DAR with Asset, AssetHolding, OrderV2, MasterOrderBookV2
      clobExchange: process.env.CLOB_EXCHANGE_PACKAGE_ID ||
        'f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454',
      // Legacy fallbacks (for backward compatibility)
      masterOrderBook: process.env.MASTER_ORDERBOOK_PACKAGE_ID ||
        'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd',
      userAccount: process.env.USER_ACCOUNT_PACKAGE_ID ||
        '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9',
    },
  },

  // Keycloak Configuration
  keycloak: {
    baseUrl: process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443',
    realm: process.env.KEYCLOAK_REALM || 'canton-devnet',
    clientId: process.env.KEYCLOAK_CLIENT_ID || 'Clob',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || null,
  },

  // Party Management
  party: {
    dailyQuota: parseInt(process.env.DAILY_PARTY_QUOTA || '5000', 10),
    weeklyQuota: parseInt(process.env.WEEKLY_PARTY_QUOTA || '35000', 10),
  },

  // WebSocket Configuration
  websocket: {
    path: '/ws',
    perMessageDeflate: false,
  },

  // API Configuration
  api: {
    timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
    batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
  },
};
