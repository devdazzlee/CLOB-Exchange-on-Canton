/**
 * Canton JSON Ledger API Configuration
 * 
 * Clean configuration following Digital Asset's recommended practices
 */

module.exports = {
  // Canton JSON Ledger API endpoints - NO HARDCODED IPs
  jsonApiBase: process.env.CANTON_JSON_API_BASE || 'http://localhost:3001',
  
  // OAuth configuration for JWT tokens
  oauth: {
    tokenUrl: process.env.CANTON_OAUTH_TOKEN_URL,
    clientId: process.env.CANTON_OAUTH_CLIENT_ID,
    clientSecret: process.env.CANTON_OAUTH_CLIENT_SECRET,
    scope: 'openid profile email daml_ledger_api'
  },

  // DAML Template IDs - should be loaded from package discovery
  templates: {
    orderBook: 'MasterOrderBookV2:MasterOrderBookV2',
    order: 'Order:Order',
    trade: 'Trade:Trade',
    userAccount: 'UserAccount:UserAccount'
  },

  // WebSocket configuration
  websocket: {
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000
  },

  // Command submission settings
  commands: {
    timeoutMs: 30000,
    maxRetries: 3,
    retryDelayMs: 2000
  },

  // Streaming settings
  streaming: {
    batchSize: 100,
    maxBufferSize: 1000
  }
};
