// Production Backend Server with Token Exchange and Party Creation
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const TokenExchangeService = require('./token-exchange');
const PartyService = require('./party-service');
const UTXOMerger = require('./utxo-merger');

const app = express();
const server = http.createServer(app);
const tokenExchange = new TokenExchangeService();
const partyService = new PartyService();
const utxoMerger = new UTXOMerger();

// No cache - query ledger directly like professional trading platforms

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
app.post('/api/create-party', async (req, res) => {
  try {
    const { publicKeyHex } = req.body;
    
    if (!publicKeyHex) {
      return res.status(400).json({ error: 'Missing publicKeyHex' });
    }

    // Validate public key format (should be hex string)
    if (!/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
      return res.status(400).json({ error: 'Invalid public key format. Expected hex string.' });
    }

    console.log('[API] POST /api/create-party');
    
    // Create party for user
    let result;
    try {
      result = await partyService.createPartyForUser(publicKeyHex);
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

/**
 * Admin endpoints - MUST be defined BEFORE the catch-all /api/ledger/* route
 * Otherwise Express will match /api/admin/* to /api/ledger/* first
 */

/**
 * Admin endpoint to create OrderBook for a trading pair
 * This should be called by the operator/admin to initialize OrderBooks
 */
app.post('/api/admin/orderbooks/:tradingPair', async (req, res) => {
  try {
    // Decode the trading pair from URL
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);
    
    // Validate trading pair format
    if (!decodedTradingPair || !decodedTradingPair.includes('/')) {
      return res.status(400).json({
        error: 'Invalid trading pair format',
        expected: 'BASE/QUOTE (e.g., BTC/USDT)',
        received: decodedTradingPair
      });
    }
    
    console.log(`[Admin] Creating OrderBook for: ${decodedTradingPair}`);
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
    
    // Check if OrderBook already exists
    const { getOrderBookContractId } = require('./canton-api-helpers');
    const existingContractId = await getOrderBookContractId(decodedTradingPair, adminToken, CANTON_JSON_API_BASE);
    
    if (existingContractId) {
      return res.status(409).json({
        error: 'OrderBook already exists',
        tradingPair: decodedTradingPair,
        contractId: existingContractId,
        message: `OrderBook for ${decodedTradingPair} already exists. Use GET /api/orderbooks/${encodeURIComponent(decodedTradingPair)} to retrieve it.`
      });
    }
    
    // Get package ID by querying for existing OrderBook contracts or checking packages
    // ROOT CAUSE: Need to find which package contains OrderBook template
    let packageId = null;
    
    try {
      // Method 1: Query for OrderBook contracts to extract package ID from templateId
      const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          readAs: [operatorPartyId],
          activeAtOffset: "0",
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: ['OrderBook:OrderBook']
                }
              }
            }
          }
        })
      });
      
      if (queryResponse.ok) {
        const queryData = await queryResponse.json();
        // Extract package ID from any existing OrderBook contract's templateId
        if (queryData.activeContracts && queryData.activeContracts.length > 0) {
          const contract = queryData.activeContracts[0];
          const templateId = contract.contractEntry?.JsActiveContract?.createdEvent?.templateId ||
                            contract.createdEvent?.templateId ||
                            contract.templateId;
          
          if (templateId && templateId.includes(':')) {
            // Template ID format: packageId:Module:Template
            packageId = templateId.split(':')[0];
            console.log('[Admin] Found package ID from existing OrderBook:', packageId);
          }
        }
      }
      
      // Method 2: If no existing contracts, try to get from packages list
      if (!packageId) {
        const packagesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/packages`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (packagesResponse.ok) {
          const packagesData = await packagesResponse.json();
          console.log('[Admin] Packages response structure:', Object.keys(packagesData));
          
          // Response format: { packageIds: [...] }
          if (packagesData.packageIds && Array.isArray(packagesData.packageIds) && packagesData.packageIds.length > 0) {
            // Use the last package ID (most recent) - this is likely our contract package
            packageId = packagesData.packageIds[packagesData.packageIds.length - 1];
            console.log('[Admin] ✓ Using latest package ID from packages list:', packageId);
          } else {
            console.warn('[Admin] ✗ packageIds array is empty or not found. Response:', JSON.stringify(packagesData).substring(0, 200));
          }
        } else {
          const errorText = await packagesResponse.text();
          console.error('[Admin] ✗ Failed to fetch packages. Status:', packagesResponse.status, 'Error:', errorText);
        }
      }
    } catch (e) {
      console.error('[Admin] Error getting package ID:', e.message);
    }
    
    // ROOT CAUSE FIX: Template ID MUST be fully qualified for contract creation
    // Format: packageId:Module:Template
    const qualifiedTemplateId = packageId ? `${packageId}:OrderBook:OrderBook` : 'OrderBook:OrderBook';
    console.log('[Admin] Using template ID:', qualifiedTemplateId);
    
    if (!packageId) {
      console.warn('[Admin] WARNING: No package ID found. Contract creation may fail.');
      console.warn('[Admin] Trying with unqualified template ID - this may not work.');
    }
    
    // Create OrderBook contract
    const commandId = `create-orderbook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // ROOT CAUSE FIX: Canton says "Unexpected fields: userAccountsactiveUsers"
    // This means the deployed template doesn't have these fields, OR they're computed fields
    // Let's try WITHOUT these fields first - only include fields that are definitely required
    // Based on OrderBookTest.daml, the minimal required fields are:
    const payload = {
      tradingPair: decodedTradingPair,
      buyOrders: [],  // [ContractId Order.Order] - empty array
      sellOrders: [], // [ContractId Order.Order] - empty array
      lastPrice: null, // Optional Decimal - null for None
      operator: operatorPartyId // Party
      // NOTE: Removing activeUsers and userAccounts - Canton says they're unexpected
      // These might be computed/derived fields or not in the deployed template version
    };
    
    console.log('[Admin] OrderBook payload:', JSON.stringify(payload, null, 2));
    
    // Build request body according to JSON API v2 spec
    // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/commands.html
    const requestBody = {
      commandId: commandId, // Required by SubmitAndWaitRequest schema - MUST be at top level
      commands: [
        {
          CreateCommand: {
            templateId: qualifiedTemplateId, // Fully qualified template ID
            createArguments: payload
          }
        }
      ],
      actAs: [operatorPartyId] // Required by SubmitAndWaitRequest schema
    };
    
    console.log('[Admin] Request body:', JSON.stringify(requestBody, null, 2));
    
    const createResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[Create OrderBook] Response status:', createResponse.status);
      console.error('[Create OrderBook] Response headers:', Object.fromEntries(createResponse.headers.entries()));
      console.error('[Create OrderBook] Full error response:', errorText);
      
      let error;
      try {
        error = JSON.parse(errorText);
        console.error('[Create OrderBook] Parsed error:', JSON.stringify(error, null, 2));
      } catch {
        error = { message: errorText };
        console.error('[Create OrderBook] Error text (not JSON):', errorText);
      }
      
      // Log the request that failed for debugging
      console.error('[Create OrderBook] Failed request body:', JSON.stringify(requestBody, null, 2));
      
      return res.status(createResponse.status).json({
        error: 'Failed to create OrderBook',
        details: error.message || error.cause || error.errors?.join(', ') || errorText,
        status: createResponse.status,
        fullError: error
      });
    }
    
    const result = await createResponse.json();
    
    // ROOT CAUSE FIX: v2 API returns { updateId, completionOffset } not { events }
    // We need to query for the contract using completionOffset
    let contractId = null;
    
    // Method 1: Check if events are present (v1 format)
    if (result.events && result.events.length > 0) {
      const createdEvent = result.events.find(e => e.created);
      if (createdEvent && createdEvent.created) {
        contractId = createdEvent.created.contractId;
        console.log('[Create OrderBook] Found contract ID from events:', contractId);
      }
    }
    
    // ROOT CAUSE FIX: Use transaction events API to get contract ID from updateId
    // This bypasses the token permission issue (admin token doesn't have operator party in actAs)
    if (!contractId && result.updateId && result.completionOffset !== undefined) {
      console.log('[Create OrderBook] Getting contract ID from transaction events using updateId:', result.updateId);
      
      try {
        // Use /v2/updates endpoint to get transaction details from updateId
        // This doesn't require party permissions - it's a transaction lookup
        const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
            body: JSON.stringify({
              beginExclusive: result.completionOffset || 0, // Use completion offset as integer
              endInclusive: result.completionOffset || 0, // Same offset for single transaction
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: [] // Empty array means match all templates for this party
                }
              }
            }
          },
          verbose: true // Get full transaction details
            })
        });
        
        if (updatesResponse.ok) {
          const updatesData = await updatesResponse.json();
          console.log('[Create OrderBook] Updates response:', JSON.stringify(updatesData, null, 2).substring(0, 1000));
          
          // Extract contract ID from transaction events
          if (updatesData.updates && updatesData.updates.length > 0) {
            for (const update of updatesData.updates) {
              if (update.transaction && update.transaction.events) {
                for (const event of update.transaction.events) {
                  if (event.created && event.created.contractId) {
                    const createdContract = event.created;
                    // Verify this is our OrderBook by checking template ID and trading pair
                    if (createdContract.templateId?.includes('OrderBook')) {
                      // Try to get trading pair from createArguments
                      const createArgs = createdContract.createArguments || createdContract.argument;
                      if (createArgs?.tradingPair === decodedTradingPair) {
                        contractId = createdContract.contractId;
                        console.log('[Create OrderBook] Found contract ID from transaction events:', contractId);
                        break; // Break out of inner for loop
                      }
                    }
                  }
                }
                if (contractId) break; // Break out of outer for loop if found
              }
            }
          }
        } else {
          const errorText = await updatesResponse.text();
          console.warn('[Create OrderBook] Updates API returned error:', updatesResponse.status, errorText);
        }
      } catch (updatesError) {
        console.error('[Create OrderBook] Error getting transaction events:', updatesError);
      }
      
      // Fallback: Try querying at completionOffset if transaction events didn't work
      if (!contractId) {
        console.log('[Create OrderBook] Transaction events did not return contract ID, trying query at completionOffset');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer for contract to be visible
        
        try {
          const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              readAs: [operatorPartyId],
              activeAtOffset: result.completionOffset.toString(),
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
            })
          });
          
          if (queryResponse.ok) {
            const queryData = await queryResponse.json();
            const contracts = Array.isArray(queryData) ? queryData : (queryData.activeContracts || []);
            
            if (contracts.length > 0) {
              const orderBook = contracts.find(contract => {
                const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                                    contract.createdEvent || 
                                    contract;
                return contractData.createArgument?.tradingPair === decodedTradingPair;
              });
              
              if (orderBook) {
                const contractData = orderBook.contractEntry?.JsActiveContract?.createdEvent || 
                                    orderBook.createdEvent || 
                                    orderBook;
                contractId = contractData.contractId;
                console.log('[Create OrderBook] Found contract ID from query at offset:', contractId);
              }
            }
          }
        } catch (queryError) {
          console.error('[Create OrderBook] Error querying at completionOffset:', queryError);
        }
      }
    }
    
    // OrderBook created - no cache needed, query ledger directly when needed
    console.log(`[Create OrderBook] OrderBook created successfully for ${decodedTradingPair}`);
    
    if (!contractId) {
      console.warn('[Create OrderBook] Contract ID not found, but creation succeeded:', JSON.stringify(result, null, 2));
      console.warn('[Create OrderBook] OrderBook was created successfully. Contract ID will be available when queried.');
      // Don't fail - the OrderBook was created, we just can't return the ID immediately
      return res.json({
        success: true,
        message: `OrderBook created successfully for ${decodedTradingPair}`,
        tradingPair: decodedTradingPair,
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        note: 'Contract ID not immediately available. Query /api/orderbooks/:tradingPair to get the contract ID.'
      });
    }
    
    console.log(`[Admin] Created OrderBook for ${decodedTradingPair}: ${contractId}`);
    
    res.json({
      success: true,
      message: `OrderBook created successfully for ${decodedTradingPair}`,
      tradingPair: decodedTradingPair,
      contractId,
      operator: operatorPartyId
    });
    
  } catch (error) {
    console.error('[Admin Create OrderBook] Error:', error);
    res.status(500).json({
      error: 'Failed to create OrderBook',
      message: error.message
    });
  }
});

/**
 * Admin endpoint to create multiple OrderBooks at once
 */
app.post('/api/admin/orderbooks', async (req, res) => {
  console.log('[Admin Route] POST /api/admin/orderbooks hit');
  console.log('[Admin Route] Body:', req.body);
  
  try {
    const { tradingPairs } = req.body;
    
    if (!tradingPairs || !Array.isArray(tradingPairs) || tradingPairs.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid tradingPairs',
        expected: { tradingPairs: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] }
      });
    }
    
    const results = [];
    
    for (const tradingPair of tradingPairs) {
      try {
        // Use internal endpoint to create each OrderBook
        const createResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/admin/orderbooks/${encodeURIComponent(tradingPair)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const result = await createResponse.json();
        results.push({
          tradingPair,
          success: createResponse.ok,
          ...result
        });
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          tradingPair,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount === tradingPairs.length,
      message: `Created ${successCount} of ${tradingPairs.length} OrderBooks`,
      results
    });
    
  } catch (error) {
    console.error('[Admin Create OrderBooks] Error:', error);
    res.status(500).json({
      error: 'Failed to create OrderBooks',
      message: error.message
    });
  }
});

// Ledger API proxy endpoints (catch-all, must be last)
app.all('/api/ledger/*', async (req, res) => {
  await tokenExchange.proxyLedgerApiCall(req, res);
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
    
    // Debug: Check what parties are in the admin token
    try {
      const parts = adminToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const ledgerApi = payload['https://daml.com/ledger-api'];
        console.log('[OrderBooks API] Admin token actAs:', ledgerApi?.actAs);
        console.log('[OrderBooks API] Admin token readAs:', ledgerApi?.readAs);
        console.log('[OrderBooks API] Operator party:', operatorPartyId);
        console.log('[OrderBooks API] Operator in actAs?', ledgerApi?.actAs?.includes?.(operatorPartyId));
      }
    } catch (e) {
      console.warn('[OrderBooks API] Could not decode admin token:', e.message);
    }
    
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
        // ROOT CAUSE FIX: API returns { packageIds: [...] } not { result: [...] }
        if (packagesData.packageIds && Array.isArray(packagesData.packageIds) && packagesData.packageIds.length > 0) {
          // Use the last package ID (most recent deployment) - this is likely our OrderBook package
          packageId = packagesData.packageIds[packagesData.packageIds.length - 1];
          console.log('[OrderBooks API] Using package ID:', packageId);
        } else if (packagesData.result && packagesData.result.length > 0) {
          // Fallback for different API response format
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
    
    // PROFESSIONAL APPROACH: Query ledger directly for all OrderBooks (no cache)
    // Scan transaction events to find all OrderBook creation events
    let orderBooksFromEvents = [];
    
    try {
      console.log('[OrderBooks API] Querying ledger transaction events for all OrderBooks...');
      const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          beginExclusive: 0, // Start from beginning (integer offset)
          endInclusive: null, // null = latest
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: [] // Empty array means match all templates for this party
                }
              }
            }
          },
          verbose: true // Get full transaction details
        })
      });
      
      if (updatesResponse.ok) {
        const updatesData = await updatesResponse.json();
        const updates = updatesData.updates || [];
        
        // Find all OrderBook creation events
        const orderBookMap = new Map(); // tradingPair -> most recent OrderBook
        
        for (const update of updates) {
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.contractId && event.created.templateId?.includes('OrderBook')) {
                const createArgs = event.created.createArguments || event.created.argument;
                const tradingPair = createArgs?.tradingPair;
                if (tradingPair) {
                  // Keep the most recent OrderBook for each trading pair
                  if (!orderBookMap.has(tradingPair)) {
                    orderBookMap.set(tradingPair, {
                      tradingPair: tradingPair,
                      contractId: event.created.contractId,
                      operator: createArgs?.operator || operatorPartyId,
                      buyOrdersCount: createArgs?.buyOrders?.length || 0,
                      sellOrdersCount: createArgs?.sellOrders?.length || 0,
                      lastPrice: createArgs?.lastPrice || null
                    });
                  }
                }
              }
            }
          }
        }
        
        orderBooksFromEvents = Array.from(orderBookMap.values());
        console.log(`[OrderBooks API] Found ${orderBooksFromEvents.length} OrderBooks in ledger`);
      }
    } catch (error) {
      console.error('[OrderBooks API] Error querying ledger for OrderBooks:', error.message);
    }
    
    // Also try querying Canton directly (may fail due to token permissions, but worth trying)
    const qualifiedTemplateId = packageId ? `${packageId}:OrderBook:OrderBook` : 'OrderBook:OrderBook';
    let orderBooksFromQuery = [];
    
    try {
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
    
      if (response.ok) {
    const result = await response.json();
        const orderBooks = Array.isArray(result) ? result : (result.activeContracts || []);
        
        orderBooksFromQuery = orderBooks
      .map(entry => {
        const contractData = entry.contractEntry?.JsActiveContract?.createdEvent || 
                           entry.createdEvent || 
                           entry;
        
            if (!contractData?.contractId || !contractData?.templateId?.includes('OrderBook')) {
          return null;
        }
        
        return {
          contractId: contractData.contractId,
          templateId: contractData.templateId,
          tradingPair: contractData.createArgument?.tradingPair || contractData.argument?.tradingPair,
          operator: contractData.createArgument?.operator || contractData.argument?.operator,
          buyOrdersCount: contractData.createArgument?.buyOrders?.length || contractData.argument?.buyOrders?.length || 0,
          sellOrdersCount: contractData.createArgument?.sellOrders?.length || contractData.argument?.sellOrders?.length || 0,
              lastPrice: contractData.createArgument?.lastPrice || contractData.argument?.lastPrice
        };
      })
      .filter(ob => ob !== null);
    
        console.log(`[OrderBooks API] Found ${orderBooksFromQuery.length} OrderBooks from Canton query`);
      } else {
        console.log('[OrderBooks API] Canton query failed (expected due to token permissions):', response.status);
      }
    } catch (error) {
      console.warn('[OrderBooks API] Error querying Canton (expected):', error.message);
    }
    
    // Merge results - prefer query results, fallback to transaction events
    const allOrderBooks = [...orderBooksFromQuery];
    
    // Add OrderBooks from transaction events that aren't already in the list
    for (const eventBook of orderBooksFromEvents) {
      if (!allOrderBooks.find(ob => ob.tradingPair === eventBook.tradingPair)) {
        allOrderBooks.push(eventBook);
      }
    }
    
    console.log(`[OrderBooks API] Total OrderBooks found: ${allOrderBooks.length} (${orderBooksFromQuery.length} from query, ${orderBooksFromEvents.length} from events)`);
    
    res.json({
      success: true,
      orderBooks: allOrderBooks,
      count: allOrderBooks.length
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
 */
app.get('/api/orderbooks/:tradingPair', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    const encodedPair = encodeURIComponent(tradingPair);
    
    // First get all OrderBooks
    const allOrderBooksResponse = await fetch(`${req.protocol}://${req.get('host')}/api/orderbooks`, {
      method: 'GET',
      headers: {
        'Authorization': req.headers.authorization || ''
      }
    });
    
    if (!allOrderBooksResponse.ok) {
      return res.status(allOrderBooksResponse.status).json({
        error: 'Failed to query OrderBooks',
        details: await allOrderBooksResponse.text()
      });
    }
    
    const data = await allOrderBooksResponse.json();
    const orderBook = data.orderBooks?.find(ob => ob.tradingPair === tradingPair);
    
    if (!orderBook) {
      return res.status(404).json({
        error: 'OrderBook not found',
        tradingPair: tradingPair,
        message: `No OrderBook found for trading pair ${tradingPair}. Please contact the operator to create it.`
      });
    }
    
    res.json({
      success: true,
      orderBook: orderBook
    });
    
  } catch (error) {
    console.error('[OrderBooks API] Error:', error);
    res.status(500).json({ 
      error: 'Failed to get OrderBook',
      message: error.message 
    });
  }
});

/**
 * PROFESSIONAL APPROACH: Query ledger directly for global OrderBook
 * No cache - query blockchain/ledger directly like Hyperliquid, Lighter, etc.
 * Uses Canton's transaction events API to find OrderBooks, then queries contracts directly
 */
app.get('/api/orderbooks/:tradingPair/orders', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);
    
    console.log(`[Global OrderBook] Querying ledger directly for ${decodedTradingPair}`);
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
    
    // STEP 1: Query ledger directly using transaction events API to find OrderBook
    // This is how professional trading platforms work - query blockchain/ledger directly
    let orderBookContractId = null;
    let orderBookOperator = null;
    
    console.log(`[Global OrderBook] Scanning ledger transaction events for OrderBook creation...`);
    
    try {
      // Query transaction events from the beginning to find all OrderBook creations
      // Professional platforms scan the ledger to find contracts
      // PROFESSIONAL APPROACH: Use backwards compatible filter/verbose format
      // According to Canton docs: Either filter/verbose OR update_format is required
      // Using filter with filtersByParty using operator party to get all transactions
      const requestBody = {
        beginExclusive: 0, // Start from beginning (integer offset)
        endInclusive: null, // null = latest
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              inclusive: {
                // Empty templateIds array means match all templates for this party
                templateIds: []
              }
            }
          }
        },
        verbose: true // Get full transaction details
      };
      
      console.log('[Global OrderBook] Request body:', JSON.stringify(requestBody));
      
      const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!updatesResponse.ok) {
        const errorText = await updatesResponse.text();
        console.error('[Global OrderBook] Updates API error:', errorText);
        console.error('[Global OrderBook] Request body sent:', JSON.stringify(requestBody));
        throw new Error(`Failed to query ledger: ${updatesResponse.status} - ${errorText}`);
      }
      
      const updatesData = await updatesResponse.json();
      const updates = updatesData.updates || [];
      console.log(`[Global OrderBook] Scanned ${updates.length} transaction events from ledger`);
      
      // Search backwards through all transactions to find the most recent OrderBook for this trading pair
      for (let i = updates.length - 1; i >= 0; i--) {
        const update = updates[i];
        if (update.transaction && update.transaction.events) {
          for (const event of update.transaction.events) {
            if (event.created && event.created.contractId && event.created.templateId?.includes('OrderBook')) {
              const createArgs = event.created.createArguments || event.created.argument;
              if (createArgs?.tradingPair === decodedTradingPair) {
                orderBookContractId = event.created.contractId;
                orderBookOperator = createArgs?.operator || operatorPartyId;
                console.log(`[Global OrderBook] ✅ Found OrderBook in ledger: ${orderBookContractId.substring(0, 30)}...`);
                break;
              }
            }
          }
          if (orderBookContractId) break;
        }
      }
    } catch (err) {
      console.error('[Global OrderBook] Error querying ledger:', err.message);
      return res.status(500).json({
        error: 'Failed to query ledger',
        message: err.message
      });
    }
    
    if (!orderBookContractId) {
      return res.status(404).json({
        error: 'OrderBook not found',
        tradingPair: decodedTradingPair,
        message: `No OrderBook found for trading pair ${decodedTradingPair} in the ledger. Please contact the operator to create it.`
      });
    }
    
    console.log(`[Global OrderBook] Found OrderBook contract: ${orderBookContractId.substring(0, 30)}...`);
    
    // Fetch the OrderBook contract using operator token
    // ROOT CAUSE FIX: Try multiple query methods since party permissions may fail
    let orderBookResponse = null;
    let orderBookData = null;
    
    // Method 1: Try filtersForAnyParty (doesn't require specific party permissions)
    try {
      console.log('[Global OrderBook] Trying filtersForAnyParty to fetch OrderBook contract...');
      orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: "0",
          filter: {
            filtersForAnyParty: {
              inclusive: {
                contractIds: [orderBookContractId]
              }
            }
          }
        })
      });
      
      if (orderBookResponse.ok) {
        orderBookData = await orderBookResponse.json();
        console.log('[Global OrderBook] Successfully fetched using filtersForAnyParty');
      } else {
        console.warn(`[Global OrderBook] filtersForAnyParty failed: ${orderBookResponse.status}`);
      }
    } catch (err) {
      console.warn('[Global OrderBook] filtersForAnyParty error:', err.message);
    }
    
    // Method 2: Try filtersByParty with readAs (fallback)
    if (!orderBookData || !orderBookResponse?.ok) {
      try {
        console.log('[Global OrderBook] Trying filtersByParty with readAs...');
        orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
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
        
        if (orderBookResponse.ok) {
          orderBookData = await orderBookResponse.json();
          console.log('[Global OrderBook] Successfully fetched using filtersByParty');
        } else {
          const errorText = await orderBookResponse.text();
          console.error('[Global OrderBook] Failed to fetch OrderBook:', orderBookResponse.status, errorText);
          return res.status(orderBookResponse.status).json({
            error: 'Failed to fetch OrderBook',
            details: errorText,
            contractId: orderBookContractId,
            note: 'OrderBook contract ID found but cannot be fetched. This may be a permission issue.'
          });
        }
      } catch (err) {
        console.error('[Global OrderBook] filtersByParty error:', err.message);
        return res.status(500).json({
          error: 'Failed to fetch OrderBook',
          details: err.message,
          contractId: orderBookContractId
        });
      }
    }
    
    if (!orderBookData) {
      return res.status(500).json({
        error: 'Failed to fetch OrderBook',
        contractId: orderBookContractId
      });
    }
    
    const orderBookContract = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent ||
                             orderBookData.activeContracts?.[0]?.createdEvent ||
                             orderBookData.activeContracts?.[0];
    
    if (!orderBookContract) {
      console.error('[Global OrderBook] Contract fetch returned empty. Response:', JSON.stringify(orderBookData).substring(0, 500));
      console.error('[Global OrderBook] activeContracts length:', orderBookData.activeContracts?.length || 0);
      
      // PROFESSIONAL APPROACH: Get OrderBook data from transaction events (no cache, query ledger directly)
      console.log('[Global OrderBook] Contract query failed, getting OrderBook data from transaction events...');
      
      // Query transaction events to get OrderBook creation event with order IDs
      const orderBookEventsResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          beginExclusive: 0, // Start from beginning (integer offset)
          endInclusive: null, // null = latest
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: [] // Empty array means match all templates for this party
                }
              }
            }
          },
          verbose: true // Get full transaction details
        })
      });
      
      if (orderBookEventsResponse.ok) {
        const orderBookEventsData = await orderBookEventsResponse.json();
        const orderBookEvents = orderBookEventsData.updates || [];
        
        // Find the OrderBook creation event
        for (let i = orderBookEvents.length - 1; i >= 0; i--) {
          const update = orderBookEvents[i];
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.contractId === orderBookContractId) {
                const createArgs = event.created.createArguments || event.created.argument;
                const buyOrderCids = createArgs?.buyOrders || [];
                const sellOrderCids = createArgs?.sellOrders || [];
                const lastPrice = createArgs?.lastPrice || null;
                
                console.log(`[Global OrderBook] Found OrderBook data in ledger: ${buyOrderCids.length} buy orders, ${sellOrderCids.length} sell orders`);
                
                // Query all order contracts directly from ledger
                const allOrderCids = [...buyOrderCids, ...sellOrderCids];
                let orderContracts = [];
                
                if (allOrderCids.length > 0) {
                  const batchSize = 50;
                  for (let i = 0; i < allOrderCids.length; i += batchSize) {
                    const batch = allOrderCids.slice(i, i + batchSize);
                    
                    try {
                      const ordersResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${adminToken}`
                        },
                        body: JSON.stringify({
                          activeAtOffset: "0",
                          filter: {
                            filtersForAnyParty: {
                              inclusive: {
                                contractIds: batch
                              }
                            }
                          }
                        })
                      });
                      
                      if (ordersResponse.ok) {
                        const ordersData = await ordersResponse.json();
                        const batchContracts = ordersData.activeContracts || [];
                        orderContracts.push(...batchContracts.map(entry => 
                          entry.contractEntry?.JsActiveContract?.createdEvent ||
                          entry.createdEvent ||
                          entry
                        ));
                      }
                    } catch (err) {
                      console.warn(`[Global OrderBook] Error fetching order batch:`, err.message);
                    }
                  }
                }
                
                // Process and return orders
                const buyOrders = orderContracts
                  .filter(contract => buyOrderCids.includes(contract.contractId))
                  .map(contract => {
                    const payload = contract.argument || contract.createArgument || {};
                    return {
                      contractId: contract.contractId,
                      price: payload.price || null,
                      quantity: parseFloat(payload.quantity || 0),
                      filled: parseFloat(payload.filled || 0),
                      remaining: parseFloat(payload.quantity || 0) - parseFloat(payload.filled || 0),
                      timestamp: payload.timestamp || 0,
                      owner: payload.owner || null,
                      orderType: payload.orderType || null,
                      status: payload.status || 'OPEN'
                    };
                  })
                  .filter(order => order.remaining > 0 && order.status === 'OPEN')
                  .sort((a, b) => {
                    if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
                    if (a.price === null) return 1;
                    if (b.price === null) return -1;
                    return b.price - a.price; // Buy orders: highest price first
                  });
                
                const sellOrders = orderContracts
                  .filter(contract => sellOrderCids.includes(contract.contractId))
                  .map(contract => {
                    const payload = contract.argument || contract.createArgument || {};
                    return {
                      contractId: contract.contractId,
                      price: payload.price || null,
                      quantity: parseFloat(payload.quantity || 0),
                      filled: parseFloat(payload.filled || 0),
                      remaining: parseFloat(payload.quantity || 0) - parseFloat(payload.filled || 0),
                      timestamp: payload.timestamp || 0,
                      owner: payload.owner || null,
                      orderType: payload.orderType || null,
                      status: payload.status || 'OPEN'
                    };
                  })
                  .filter(order => order.remaining > 0 && order.status === 'OPEN')
                  .sort((a, b) => {
                    if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
                    if (a.price === null) return 1;
                    if (b.price === null) return -1;
                    return a.price - b.price; // Sell orders: lowest price first
                  });
                
                return res.json({
                  success: true,
                  tradingPair: decodedTradingPair,
                  contractId: orderBookContractId,
                  operator: createArgs?.operator || orderBookOperator || operatorPartyId,
                  buyOrders: buyOrders,
                  sellOrders: sellOrders,
                  buyOrdersCount: buyOrders.length,
                  sellOrdersCount: sellOrders.length,
                  lastPrice: lastPrice
                });
              }
            }
          }
        }
      }
      
      // If we can't get OrderBook data, return empty order book
      console.log('[Global OrderBook] Could not fetch OrderBook data, returning empty order book');
      return res.json({
        success: true,
        tradingPair: decodedTradingPair,
        contractId: orderBookContractId,
        operator: orderBookOperator || operatorPartyId,
        buyOrders: [],
        sellOrders: [],
        buyOrdersCount: 0,
        sellOrdersCount: 0,
        lastPrice: null
      });
    }
    
    const buyOrderCids = orderBookContract.createArgument?.buyOrders || orderBookContract.argument?.buyOrders || [];
    const sellOrderCids = orderBookContract.createArgument?.sellOrders || orderBookContract.argument?.sellOrders || [];
    
    console.log(`[Global OrderBook] OrderBook contains ${buyOrderCids.length} buy orders and ${sellOrderCids.length} sell orders`);
    
    // Fetch all order contracts using operator token (so we can see ALL orders, not just user's orders)
    const allOrderCids = [...buyOrderCids, ...sellOrderCids];
    let orderContracts = [];
    
    if (allOrderCids.length > 0) {
      // Fetch orders in batches to avoid URL length limits
      const batchSize = 50;
      for (let i = 0; i < allOrderCids.length; i += batchSize) {
        const batch = allOrderCids.slice(i, i + batchSize);
        
        const ordersResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
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
                    contractIds: batch
                  }
                }
              }
            }
          })
        });
        
        if (ordersResponse.ok) {
          const ordersData = await ordersResponse.json();
          const batchContracts = ordersData.activeContracts || [];
          orderContracts.push(...batchContracts.map(entry => 
            entry.contractEntry?.JsActiveContract?.createdEvent ||
            entry.createdEvent ||
            entry
          ));
        } else {
          console.warn(`[Global OrderBook] Failed to fetch order batch ${i}-${i + batch.length}:`, ordersResponse.status);
        }
      }
    }
    
    console.log(`[Global OrderBook] Fetched ${orderContracts.length} order contracts`);
    
    // Process orders into buy/sell arrays
    const buyOrders = orderContracts
      .filter(contract => {
        const cid = contract.contractId;
        return buyOrderCids.includes(cid) && contract.argument?.status === 'OPEN';
      })
      .map(contract => {
        const payload = contract.argument || contract.createArgument || {};
        return {
          contractId: contract.contractId,
          price: payload.price || null,
          quantity: parseFloat(payload.quantity || 0),
          filled: parseFloat(payload.filled || 0),
          remaining: parseFloat(payload.quantity || 0) - parseFloat(payload.filled || 0),
          timestamp: payload.timestamp || 0,
          owner: payload.owner || null,
          orderType: payload.orderType || null,
          status: payload.status || 'OPEN'
        };
      })
      .filter(order => order.remaining > 0)
      .sort((a, b) => {
        if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        if (b.price !== a.price) return b.price - a.price;
        return a.timestamp - b.timestamp;
      });
    
    const sellOrders = orderContracts
      .filter(contract => {
        const cid = contract.contractId;
        return sellOrderCids.includes(cid) && contract.argument?.status === 'OPEN';
      })
      .map(contract => {
        const payload = contract.argument || contract.createArgument || {};
        return {
          contractId: contract.contractId,
          price: payload.price || null,
          quantity: parseFloat(payload.quantity || 0),
          filled: parseFloat(payload.filled || 0),
          remaining: parseFloat(payload.quantity || 0) - parseFloat(payload.filled || 0),
          timestamp: payload.timestamp || 0,
          owner: payload.owner || null,
          orderType: payload.orderType || null,
          status: payload.status || 'OPEN'
        };
      })
      .filter(order => order.remaining > 0)
      .sort((a, b) => {
        if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        if (a.price !== b.price) return a.price - b.price;
        return a.timestamp - b.timestamp;
      });
    
    console.log(`[Global OrderBook] Returning ${buyOrders.length} buy orders and ${sellOrders.length} sell orders`);
    
    res.json({
      success: true,
      tradingPair: decodedTradingPair,
      contractId: orderBookContractId,
      operator: orderBookContract.createArgument?.operator || orderBookContract.argument?.operator,
      buyOrders: buyOrders,
      sellOrders: sellOrders,
      buyOrdersCount: buyOrders.length,
      sellOrdersCount: sellOrders.length,
      lastPrice: orderBookContract.createArgument?.lastPrice || orderBookContract.argument?.lastPrice
    });
    
  } catch (error) {
    console.error('[Global OrderBook] Error:', error);
    res.status(500).json({ 
      error: 'Failed to get global OrderBook',
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
 * UTXO Merging endpoint
 * Merges UTXOs for a user account to consolidate balances
 * This is critical for Canton's UTXO model - when orders are cancelled,
 * UTXOs may remain separate, preventing larger orders
 */
app.post('/api/utxo/merge', async (req, res) => {
  try {
    const { partyId, token, userAccountContractId } = req.body;
    
    if (!partyId || !token || !userAccountContractId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['partyId', 'token', 'userAccountContractId']
      });
    }
    
    const result = await utxoMerger.mergeUTXOs(partyId, token, userAccountContractId);
    
    res.json({
      success: true,
      message: `UTXOs merged successfully for ${token}`,
      result
    });
  } catch (error) {
    console.error('[UTXO Merge API] Error:', error);
    res.status(500).json({
      error: 'Failed to merge UTXOs',
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

// Log registered routes for debugging
function logRegisteredRoutes() {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${middleware.route.path}`);
    }
  });
  
  console.log('\n📋 Registered Routes:');
  routes.forEach(route => console.log(`  ${route}`));
  console.log('');
  
  // Verify admin routes are registered
  const adminRoutes = routes.filter(r => r.includes('/api/admin/orderbooks'));
  if (adminRoutes.length > 0) {
    console.log('✅ Admin routes registered:', adminRoutes);
  } else {
    console.error('❌ ERROR: Admin routes NOT registered!');
  }
}

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log(`Party creation quota: ${process.env.DAILY_PARTY_QUOTA || '5000'} daily, ${process.env.WEEKLY_PARTY_QUOTA || '35000'} weekly`);
  
  // Log routes after server starts
  setTimeout(() => logRegisteredRoutes(), 100);
});
