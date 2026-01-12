// Production Backend Server with Token Exchange and Party Creation
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const TokenExchangeService = require('./token-exchange');
const PartyService = require('./party-service');
const OrderBookService = require('./orderbook-service');

const app = express();
const server = http.createServer(app);
const tokenExchange = new TokenExchangeService();
const partyService = new PartyService();
const orderBookService = new OrderBookService();

// WebSocket Server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  perMessageDeflate: false
});

// WebSocket connection management
const clients = new Map(); // clientId -> { ws, subscriptions: Set }

wss.on('connection', (ws, req) => {
  const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  clients.set(clientId, { ws, subscriptions: new Set() });
  
  console.log(`[WebSocket] Client connected: ${clientId} (Total: ${clients.size})`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      
      if (data.type === 'subscribe') {
        const { channel } = data;
        if (channel) {
          clients.get(clientId).subscriptions.add(channel);
          console.log(`[WebSocket] Client ${clientId} subscribed to ${channel}`);
          ws.send(JSON.stringify({ type: 'subscribed', channel }));
        }
      }
      
      if (data.type === 'unsubscribe') {
        const { channel } = data;
        if (channel) {
          clients.get(clientId).subscriptions.delete(channel);
          console.log(`[WebSocket] Client ${clientId} unsubscribed from ${channel}`);
          ws.send(JSON.stringify({ type: 'unsubscribed', channel }));
        }
      }
    } catch (error) {
      console.error('[WebSocket] Error handling message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WebSocket] Client disconnected: ${clientId} (Total: ${clients.size})`);
  });

  ws.on('error', (error) => {
    console.error(`[WebSocket] Error for client ${clientId}:`, error);
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'connected', clientId }));
});

// Broadcast function to send messages to subscribed clients
function broadcast(channel, data) {
  const message = JSON.stringify({ channel, data, timestamp: new Date().toISOString() });
  let sentCount = 0;
  
  clients.forEach((client, clientId) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
        sentCount++;
      } catch (error) {
        console.error(`[WebSocket] Error sending to client ${clientId}:`, error);
      }
    }
  });
  
  if (sentCount > 0) {
    console.log(`[WebSocket] Broadcasted to ${sentCount} clients on channel ${channel}`);
  }
}

// Export broadcast function for use in other modules
global.broadcastWebSocket = broadcast;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'https://clob-exchange-on-canton.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ];
    
    // Check if origin is in allowed list
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Party creation endpoint - creates party ID on behalf of user
// Uses Huzefa's approach: user's OAuth token with actAs/readAs claims instead of admin service account
app.post('/api/create-party', async (req, res) => {
  try {
    const { publicKeyHex, userToken } = req.body;
    
    if (!publicKeyHex) {
      return res.status(400).json({ error: 'Missing publicKeyHex' });
    }

    // Validate public key format (should be hex string)
    if (!/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
      return res.status(400).json({ error: 'Invalid public key format. Expected hex string.' });
    }

    console.log('[API] POST /api/create-party');
    console.log('[API] Using user token approach (Huzefa method)');
    
    // Create party for user using their own token (which already has actAs/readAs claims)
    let result;
    try {
      result = await partyService.createPartyForUser(publicKeyHex, userToken);
    } catch (serviceError) {
      console.error('[API] Error:', serviceError.message);
      throw serviceError;
    }
    
    // Validate result before returning
    if (!result || !result.token || typeof result.token !== 'string' || result.token.trim() === '') {
      throw new Error('Invalid result from party creation');
    }
    
    // Final check before sending response
    if (!result.token) {
      console.error('[API] CRITICAL: Token became null right before sending response');
      throw new Error('Token validation failed at the last moment - this should never happen');
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('[API] Party creation error:', error);
    
    // Handle quota errors specifically
    if (error.message.includes('quota')) {
      return res.status(429).json({ 
        error: error.message,
        code: 'QUOTA_EXCEEDED'
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Get quota status
app.get('/api/quota-status', async (req, res) => {
  try {
    const status = partyService.getQuotaStatus();
    res.json(status);
  } catch (error) {
    console.error('[API] Quota status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Token exchange endpoint
app.post('/api/token-exchange', async (req, res) => {
  try {
    const { keycloakToken } = req.body;
    
    if (!keycloakToken) {
      return res.status(400).json({ error: 'Missing keycloakToken' });
    }
    
    const result = await tokenExchange.exchangeToken(keycloakToken);
    res.json(result);
    
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(401).json({ error: error.message });
  }
});

// Ledger API proxy endpoints
app.all('/api/ledger/*', async (req, res) => {
  await tokenExchange.proxyLedgerApiCall(req, res);
});

/**
 * Automatic OrderBook creation endpoint (Professional approach)
 * Creates OrderBook if not exists - called automatically by frontend
 * Uses user's token with actAs claims (Huzefa approach)
 */
app.post('/api/orderbooks/:tradingPair/ensure', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    let { userToken, userPartyId } = req.body;
    
    if (!userToken) {
      // Try to get from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Missing user token',
          message: 'User token with actAs/readAs claims is required (Huzefa approach)'
        });
      }
      userToken = authHeader.substring(7);
    }
    
    console.log(`[OrderBooks API] Ensuring OrderBook exists for ${tradingPair}...`);
    
    const result = await orderBookService.ensureOrderBookExists(
      tradingPair, 
      userToken, 
      userPartyId || ''
    );
    
    if (result.exists) {
      res.json({
        success: true,
        exists: true,
        created: result.created || false,
        contractId: result.contractId || null,
        tradingPair: tradingPair,
        message: result.created 
          ? `OrderBook for ${tradingPair} created automatically` 
          : `OrderBook for ${tradingPair} already exists`
      });
    } else {
      res.status(500).json({
        success: false,
        exists: false,
        created: false,
        tradingPair: tradingPair,
        error: result.error || 'Failed to create OrderBook',
        message: `Could not create OrderBook for ${tradingPair}. Please check permissions.`
      });
    }
  } catch (error) {
    console.error('[OrderBooks API] Error ensuring OrderBook:', error);
    res.status(500).json({
      error: 'Failed to ensure OrderBook exists',
      message: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test Service Account configuration - detailed inspection
// Diagnostic endpoint to inspect token claims
app.post('/api/inspect-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Invalid token format' });
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const ledgerApi = payload['https://daml.com/ledgerapi'];
    
    res.json({
      hasLedgerApiClaim: !!ledgerApi,
      ledgerApiClaim: ledgerApi,
      actAs: ledgerApi?.actAs || null,
      readAs: ledgerApi?.readAs || null,
      hasParty: ledgerApi?.actAs?.includes ? 'Check actAs array' : 'actAs is not an array',
      allClaims: Object.keys(payload),
      payload: payload
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test-service-account', async (req, res) => {
  try {
    const adminToken = await partyService.getKeycloakAdminToken();
    
    // Decode token to inspect its contents
    let tokenInfo = {};
    try {
      const parts = adminToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        tokenInfo = {
          sub: payload.sub,
          client_id: payload.client_id || payload.azp,
          scope: payload.scope,
          realm_access: payload.realm_access,
          resource_access: payload.resource_access,
          realm_roles: payload.realm_access?.roles || [],
          realm_management_roles: payload.resource_access?.['realm-management']?.roles || [],
        };
      }
    } catch (e) {
      tokenInfo.error = 'Could not decode token: ' + e.message;
    }
    
    // Try to list users (minimal permission check)
    const testUrl = `${process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443'}/admin/realms/${process.env.KEYCLOAK_REALM || 'canton-devnet'}/users?max=1`;
    const testResponse = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    const responseText = await testResponse.text();
    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }
    
    if (testResponse.ok) {
      res.json({ 
        status: 'success', 
        message: 'Keycloak Admin API is reachable with the configured service account token',
        canCreateUsers: true,
        tokenInfo: tokenInfo,
        testResponse: responseData
      });
    } else {
      res.status(testResponse.status).json({ 
        status: 'error',
        message: `Admin API returned ${testResponse.status}`,
        canCreateUsers: false,
        tokenInfo: tokenInfo,
        errorResponse: responseData,
        hasManageUsersRole: tokenInfo.realm_management_roles?.includes('manage-users') || false,
        note: 'This endpoint only checks Keycloak admin permissions. Canton authorization is handled via Ledger API user rights (GrantUserRights) and does not require Keycloak mappers.'
      });
    }
  } catch (error) {
    res.status(500).json({ 
        status: 'error',
      message: error.message,
        canCreateUsers: false,
      stack: error.stack
    });
  }
});

/**
 * Query global OrderBooks using operator token
 * This endpoint allows users to discover OrderBooks that were created by the operator
 * Users can't see OrderBooks directly because they're only signed by the operator
 */
app.get('/api/orderbooks', async (req, res) => {
  try {
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    
    // Get operator party ID from environment or use validator-operator
    // The operator party is the one that creates OrderBooks
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
    
    // Query OrderBooks using operator's token (they can see OrderBooks they created)
    const queryUrl = `${CANTON_JSON_API_BASE}/v2/state/active-contracts`;
    
    // Get package ID first (we need it to qualify the template ID)
    let packageId = null;
    try {
      const packagesUrl = `${CANTON_JSON_API_BASE}/v2/packages`;
      const packagesResponse = await fetch(packagesUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (packagesResponse.ok) {
        const packagesData = await packagesResponse.json();
        if (packagesData.result && packagesData.result.length > 0) {
          // Find the package that contains OrderBook template
          const orderBookPackage = packagesData.result.find(pkg => 
            pkg.packageId && (pkg.name === 'clob-exchange' || pkg.name?.includes('clob'))
          );
          if (orderBookPackage) {
            packageId = orderBookPackage.packageId;
          } else if (packagesData.result[0]) {
            packageId = packagesData.result[0].packageId;
          }
        }
      }
    } catch (e) {
      console.warn('[OrderBooks API] Could not get package ID:', e.message);
    }
    
    // Query for OrderBook contracts
    const qualifiedTemplateId = packageId ? `${packageId}:OrderBook:OrderBook` : 'OrderBook:OrderBook';
    
    const requestBody = {
      readAs: [operatorPartyId],
      activeAtOffset: "0",
      verbose: true,
      filter: {
        filtersByParty: {
          [operatorPartyId]: {
            inclusive: {
              templateIds: [qualifiedTemplateId]
            }
          }
        }
      }
    };
    
    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText };
      }
      console.error('[OrderBooks API] Query failed:', error);
      return res.status(response.status).json({ 
        error: 'Failed to query OrderBooks',
        details: error.message || error.cause || error.errors?.join(', ')
      });
    }
    
    const result = await response.json();
    
    // Parse response to extract OrderBook contracts
    let orderBooks = [];
    if (Array.isArray(result)) {
      orderBooks = result;
    } else if (result.activeContracts) {
      orderBooks = result.activeContracts;
    } else if (result.contractEntry) {
      orderBooks = [result];
    }
    
    // Extract OrderBook data
    const orderBooksList = orderBooks
      .map(entry => {
        const contractData = entry.contractEntry?.JsActiveContract?.createdEvent || 
                           entry.createdEvent || 
                           entry;
        
        if (!contractData.contractId || !contractData.templateId?.includes('OrderBook')) {
          return null;
        }
        
        return {
          contractId: contractData.contractId,
          templateId: contractData.templateId,
          tradingPair: contractData.createArgument?.tradingPair || contractData.argument?.tradingPair,
          operator: contractData.createArgument?.operator || contractData.argument?.operator,
          buyOrdersCount: contractData.createArgument?.buyOrders?.length || contractData.argument?.buyOrders?.length || 0,
          sellOrdersCount: contractData.createArgument?.sellOrders?.length || contractData.argument?.sellOrders?.length || 0,
          lastPrice: contractData.createArgument?.lastPrice || contractData.argument?.lastPrice,
          offset: contractData.offset
        };
      })
      .filter(ob => ob !== null);
    
    console.log(`[OrderBooks API] Found ${orderBooksList.length} OrderBooks`);
    
    res.json({
      success: true,
      orderBooks: orderBooksList,
      count: orderBooksList.length
    });
    
  } catch (error) {
    console.error('[OrderBooks API] Error:', error);
      res.status(500).json({ 
      error: 'Failed to query OrderBooks',
      message: error.message 
    });
  }
});

/**
 * Get OrderBook for a specific trading pair
 * Professional approach: Automatically creates if not exists (like professional trading platforms)
 */
app.get('/api/orderbooks/:tradingPair', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    
    // Get user token from Authorization header (Huzefa approach)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing authorization token',
        message: 'User token is required (Huzefa approach - token with actAs/readAs claims)'
      });
    }
    
    const userToken = authHeader.substring(7); // Remove "Bearer " prefix
    
    // Extract user party ID from token
    let userPartyId;
    try {
      const parts = userToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        // Try to get party ID from token claims or use sub
        userPartyId = payload.partyId || payload.sub || null;
      }
    } catch (e) {
      console.warn('[OrderBooks API] Could not extract party ID from token');
    }
    
    // First, check if OrderBook exists
    const exists = await orderBookService.checkOrderBookExists(tradingPair, userToken, userPartyId || '');
    
    if (exists) {
      // OrderBook exists - return it
      const allOrderBooksResponse = await fetch(`${req.protocol}://${req.get('host')}/api/orderbooks`, {
        method: 'GET',
        headers: {
          'Authorization': req.headers.authorization || ''
        }
      });
      
      if (allOrderBooksResponse.ok) {
        const data = await allOrderBooksResponse.json();
        const orderBook = data.orderBooks?.find(ob => ob.tradingPair === tradingPair);
        
        if (orderBook) {
          return res.json({
            success: true,
            orderBook: orderBook,
            autoCreated: false
          });
        }
      }
    }
    
    // OrderBook doesn't exist - create it automatically (Professional approach)
    console.log(`[OrderBooks API] 🔄 OrderBook for ${tradingPair} not found - creating automatically...`);
    const createResult = await orderBookService.ensureOrderBookExists(tradingPair, userToken, userPartyId || '');
    
    if (createResult.exists && createResult.created) {
      // Successfully created - return the created OrderBook
      return res.json({
        success: true,
        orderBook: {
          contractId: createResult.contractId,
          tradingPair: tradingPair,
          operator: createResult.operator || null,
          buyOrders: [],
          sellOrders: [],
          autoCreated: true
        },
        message: `OrderBook for ${tradingPair} created automatically`
      });
    } else if (createResult.exists && !createResult.created) {
      // OrderBook exists but wasn't created by us (race condition or visibility issue)
      // Try to fetch it again
      const allOrderBooksResponse = await fetch(`${req.protocol}://${req.get('host')}/api/orderbooks`, {
        method: 'GET',
        headers: {
          'Authorization': req.headers.authorization || ''
        }
      });
      
      if (allOrderBooksResponse.ok) {
        const data = await allOrderBooksResponse.json();
        const orderBook = data.orderBooks?.find(ob => ob.tradingPair === tradingPair);
        
        if (orderBook) {
          return res.json({
            success: true,
            orderBook: orderBook,
            autoCreated: false
          });
        }
      }
    }
    
    // If we get here, creation failed or OrderBook not found after creation
    return res.status(404).json({
      error: 'OrderBook not found and could not be created automatically',
      tradingPair: tradingPair,
      message: `OrderBook for ${tradingPair} was not found and automatic creation failed. Please try placing an order - it will be created automatically.`,
      error: createResult.error
    });
    
  } catch (error) {
    console.error('[OrderBooks API] Error:', error);
    res.status(500).json({ 
      error: 'Failed to get or create OrderBook',
      message: error.message 
    });
  }
});

/**
 * Update OrderBook's userAccounts map when a UserAccount is created
 * This allows the matching engine to update balances after trades
 */
app.post('/api/orderbooks/:tradingPair/update-user-account', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    const { partyId, userAccountContractId } = req.body;
    
    if (!partyId || !userAccountContractId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['partyId', 'userAccountContractId']
      });
    }
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
    
    // Get the OrderBook contract ID for this trading pair
    const { getOrderBookContractId } = require('./canton-api-helpers');
    const orderBookContractId = await getOrderBookContractId(tradingPair, adminToken, CANTON_JSON_API_BASE);
    
    if (!orderBookContractId) {
      return res.status(404).json({ 
        error: 'OrderBook not found',
        tradingPair 
      });
    }
    
    // Fetch current OrderBook to get userAccounts map
    const orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        readAs: [operatorPartyId],
        activeAtOffset: "0",
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              inclusive: {
                contractIds: [orderBookContractId]
              }
            }
          }
        }
      })
    });
    
    if (!orderBookResponse.ok) {
      throw new Error('Failed to fetch OrderBook');
    }
    
    const orderBookData = await orderBookResponse.json();
    const orderBook = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent;
    
    if (!orderBook) {
      throw new Error('OrderBook contract not found');
    }
    
    // Exercise UpdateUserAccount choice on OrderBook
    const commandId = `update-user-account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const exerciseResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        commandId: commandId,
        commands: [
          {
            exercise: {
              templateId: 'OrderBook:OrderBook',
              contractId: orderBookContractId,
              choice: 'UpdateUserAccount',
              argument: {
                party: partyId,
                userAccountCid: userAccountContractId
              }
            }
          }
        ],
        actAs: [operatorPartyId]
      })
    });
    
    if (!exerciseResponse.ok) {
      const errorText = await exerciseResponse.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText };
      }
      throw new Error(error.message || error.cause || `Failed to exercise UpdateUserAccount: ${exerciseResponse.statusText}`);
    }
    
    const exerciseResult = await exerciseResponse.json();
    
    // Broadcast order book update via WebSocket
    const { broadcastOrderBookUpdate } = require('./canton-api-helpers');
    broadcastOrderBookUpdate(tradingPair, {
      buyOrders: orderBook.createArgument?.buyOrders || [],
      sellOrders: orderBook.createArgument?.sellOrders || [],
      lastPrice: orderBook.createArgument?.lastPrice
    });
    
    res.json({
      success: true,
      message: 'UserAccount added to OrderBook map',
      tradingPair,
      partyId,
      userAccountContractId,
      result: exerciseResult
    });
    
  } catch (error) {
    console.error('[UpdateUserAccount] Error:', error);
    res.status(500).json({ 
      error: 'Failed to update OrderBook userAccounts map',
      message: error.message 
    });
  }
});

/**
 * WebSocket health check endpoint
 */
app.get('/api/ws/status', (req, res) => {
  res.json({
    connected: clients.size,
    channels: Array.from(new Set(
      Array.from(clients.values())
        .flatMap(client => Array.from(client.subscriptions))
    ))
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log(`Party creation quota: ${process.env.DAILY_PARTY_QUOTA || '5000'} daily, ${process.env.WEEKLY_PARTY_QUOTA || '35000'} weekly`);
});
