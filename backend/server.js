// Production Backend Server with Token Exchange and Party Creation
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const TokenExchangeService = require('./token-exchange');
const PartyService = require('./party-service');
const UTXOMerger = require('./utxo-merger');
const UTXOHandler = require('./utxo-handler');
const OrderService = require('./order-service');

const app = express();
const server = http.createServer(app);
const tokenExchange = new TokenExchangeService();
const partyService = new PartyService();
const utxoMerger = new UTXOMerger();
const utxoHandler = new UTXOHandler();
const orderService = new OrderService();

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
async function getLedgerEndOffset(adminToken) {
  const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.offset || null;
    }
  } catch (e) {
    console.warn('[Ledger End] Failed to get ledger end:', e.message);
  }
  return null;
}

async function getActiveAtOffset(adminToken, completionOffset = null) {
  if (completionOffset) {
    return completionOffset.toString();
  }
  const ledgerEnd = await getLedgerEndOffset(adminToken);
  if (ledgerEnd) {
    return ledgerEnd.toString();
  }
  throw new Error('Could not determine activeAtOffset');
}

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
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
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
      const activeAtOffset1 = await getActiveAtOffset(adminToken);
      const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          readAs: [operatorPartyId],
          activeAtOffset: activeAtOffset1,
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
      
      // Method 2: Query for OrderBook template using filtersForAnyParty to get package ID
      if (!packageId) {
        try {
          const activeAtOffset2 = await getActiveAtOffset(adminToken);
          const templateQueryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              activeAtOffset: activeAtOffset2,
              filter: {
                filtersForAnyParty: {
                  inclusive: {
                    templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']
                  }
                }
              }
            })
          });
          
          if (templateQueryResponse.ok) {
            const templateData = await templateQueryResponse.json();
            // Try to extract package ID from any contract's templateId
            if (templateData.activeContracts && templateData.activeContracts.length > 0) {
              const contract = templateData.activeContracts[0];
              const templateId = contract.contractEntry?.JsActiveContract?.createdEvent?.templateId ||
                                contract.createdEvent?.templateId ||
                                contract.templateId;
              
              if (templateId && templateId.includes(':')) {
                packageId = templateId.split(':')[0];
                console.log('[Admin] ✓ Found package ID from template query:', packageId);
              }
            }
          }
        } catch (e) {
          console.warn('[Admin] Template query failed:', e.message);
        }
      }
      
      // Method 3: If still no package ID, try to get from packages list
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
            // Try to find package that contains OrderBook by checking recent packages
            // Use the last few package IDs and try them
            const recentPackages = packagesData.packageIds.slice(-5).reverse();
            
            // Try each recent package to see if it has OrderBook
            for (const pkgId of recentPackages) {
              try {
                const activeAtOffset3 = await getActiveAtOffset(adminToken);
                const testQuery = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    activeAtOffset: activeAtOffset3,
                    filter: {
                      filtersForAnyParty: {
                        inclusive: {
                          templateIds: [`${pkgId}:OrderBook:OrderBook`]
                        }
                      }
                    }
                  })
                });
                
                if (testQuery.ok) {
                  const testData = await testQuery.json();
                  // If we get a response (even empty), the template exists in this package
                  packageId = pkgId;
                  console.log('[Admin] ✓ Found package ID by testing packages:', packageId);
                  break;
                }
              } catch (e) {
                continue;
              }
            }
            
            // If still no package ID, use the most recent one as fallback
            if (!packageId) {
              packageId = packagesData.packageIds[packagesData.packageIds.length - 1];
              console.log('[Admin] ⚠ Using latest package ID as fallback:', packageId);
            }
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
    
    // EXPERT FIX: Discover template dynamically instead of hardcoding package ID
    let templateIdToUse = null;
    let discoveredPackageId = null;
    
    // Method 1: Query for existing OrderBook contracts to extract package ID
    try {
      const activeAtOffset4 = await getActiveAtOffset(adminToken);
      const existingQuery = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activeAtOffset: activeAtOffset4,
          verbose: true,
          filter: {
            filtersForAnyParty: {
              inclusive: {
                templateIds: ['OrderBook:OrderBook'] // Unqualified - Canton will match any package
              }
            }
          }
        })
      });
      
      if (existingQuery.ok) {
        const existingData = await existingQuery.json();
        const contracts = Array.isArray(existingData) ? existingData : (existingData.activeContracts || []);
        
        if (contracts.length > 0) {
          const contract = contracts[0];
          const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                              contract.createdEvent || 
                              contract;
          const fullTemplateId = contractData.templateId;
          
          if (fullTemplateId && fullTemplateId.includes(':')) {
            // Extract package ID from fully qualified template ID
            discoveredPackageId = fullTemplateId.split(':')[0];
            templateIdToUse = fullTemplateId; // Use the same template ID that's already working
            console.log('[Admin] ✅ Discovered template from existing contracts:', templateIdToUse);
          }
        }
      }
    } catch (e) {
      console.warn('[Admin] Template discovery from existing contracts failed:', e.message);
    }
    
    // Method 2: Fallback to known working package ID if discovery failed
    if (!templateIdToUse) {
      const WORKING_PACKAGE_ID = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
      // Try MasterOrderBook first, fallback to OrderBook
      templateIdToUse = `${WORKING_PACKAGE_ID}:MasterOrderBook:MasterOrderBook`;
      // Fallback: `${WORKING_PACKAGE_ID}:OrderBook:OrderBook`;
      discoveredPackageId = WORKING_PACKAGE_ID;
      console.log('[Admin] Using fallback package ID:', WORKING_PACKAGE_ID);
    }
    
    console.log('[Admin] Template ID to use:', templateIdToUse);
    
    // Create OrderBook contract - DIRECT, NO LOOPS, NO FALLBACKS
    const commandId = `create-orderbook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Use MasterOrderBook template (Global Order Book model)
    const payload = {
      operator: operatorPartyId,
      publicObserver: 'public-observer', // Public observer for global visibility
      tradingPair: decodedTradingPair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: null,
      activeUsers: [],
      userAccounts: null
    };
    
    console.log('[Admin] OrderBook payload:', JSON.stringify(payload, null, 2));
    
    const requestBody = {
      commandId: commandId,
      commands: [
        {
          CreateCommand: {
            templateId: templateIdToUse,
            createArguments: payload
          }
        }
      ],
      actAs: [operatorPartyId]
    };
    
    console.log('[Admin] Creating OrderBook with template:', templateIdToUse);
    
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
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { code: 'UNKNOWN', cause: errorText };
      }
      
      console.error('[Create OrderBook] Error response:', {
        status: createResponse.status,
        code: errorData.code,
        cause: errorData.cause,
        templateId: templateIdToUse
      });
      
      // If MasterOrderBook doesn't exist (404 or TEMPLATES_OR_INTERFACES_NOT_FOUND), try OrderBook:OrderBook as fallback
      const isTemplateNotFound = 
        errorData.code === 'TEMPLATES_OR_INTERFACES_NOT_FOUND' ||
        (createResponse.status === 404 && errorText.includes('TEMPLATE')) ||
        (errorText.includes('MasterOrderBook') && errorText.includes('not found'));
      
      if (isTemplateNotFound && templateIdToUse.includes('MasterOrderBook')) {
        console.log('[Admin] MasterOrderBook not found, falling back to OrderBook:OrderBook...');
        const packageIdFromTemplate = templateIdToUse.split(':')[0];
        templateIdToUse = `${packageIdFromTemplate}:OrderBook:OrderBook`;
        
        // Update payload for OrderBook template (no publicObserver, activeUsers, userAccounts)
        payload = {
          tradingPair: decodedTradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: operatorPartyId
        };
        
        requestBody.commands[0].CreateCommand.templateId = templateIdToUse;
        requestBody.commands[0].CreateCommand.createArguments = payload;
        
        console.log('[Admin] Retrying with OrderBook:OrderBook template:', templateIdToUse);
        
        const fallbackResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!fallbackResponse.ok) {
          const fallbackErrorText = await fallbackResponse.text();
          let fallbackErrorData;
          try {
            fallbackErrorData = JSON.parse(fallbackErrorText);
          } catch {
            fallbackErrorData = { code: 'UNKNOWN', cause: fallbackErrorText };
          }
          
          console.error('[Create OrderBook] Fallback also failed:', {
            status: fallbackResponse.status,
            code: fallbackErrorData.code,
            cause: fallbackErrorData.cause,
            templateId: templateIdToUse
          });
          
          return res.status(fallbackResponse.status).json({
            error: 'Failed to create OrderBook',
            message: fallbackErrorData.cause || fallbackErrorData.message || fallbackErrorText,
            details: fallbackErrorText,
            status: fallbackResponse.status,
            tried: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook'],
            errorCode: fallbackErrorData.code
          });
        }
        
        // Use the fallback response
        const result = await fallbackResponse.json();
        console.log('[Admin] ✓ OrderBook created successfully (using OrderBook:OrderBook fallback)');
        console.log('[Admin] Response:', JSON.stringify(result, null, 2));
        
        // Continue with contract ID extraction using the fallback result
        // (The code below will handle extracting the contract ID)
        // We need to set createResponse to fallbackResponse for the rest of the code
        const fallbackResult = result;
        
        // Extract contract ID from fallback result
        let contractId = null;
        if (fallbackResult.events && Array.isArray(fallbackResult.events)) {
          for (const event of fallbackResult.events) {
            if (event.created?.contractId) {
              contractId = event.created.contractId;
              break;
            }
          }
        }
        if (!contractId && fallbackResult.transactionEvents && Array.isArray(fallbackResult.transactionEvents)) {
          for (const event of fallbackResult.transactionEvents) {
            if (event.created?.contractId) {
              contractId = event.created.contractId;
              break;
            }
          }
        }
        if (!contractId && fallbackResult.contractId) {
          contractId = fallbackResult.contractId;
        }
        
        if (contractId) {
          return res.json({
            success: true,
            message: `OrderBook created successfully for ${decodedTradingPair} (using OrderBook:OrderBook template)`,
            tradingPair: decodedTradingPair,
            contractId,
            operator: operatorPartyId,
            template: 'OrderBook:OrderBook'
          });
        }
      }
      
      console.error('[Create OrderBook] Failed:', createResponse.status, errorText);
      return res.status(createResponse.status).json({
        error: 'Failed to create OrderBook',
        details: errorText,
        status: createResponse.status
      });
    }
    
    const result = await createResponse.json();
    console.log('[Admin] ✓ OrderBook created successfully');
    console.log('[Admin] Response:', JSON.stringify(result, null, 2));
    
    // Per Sync Global scan API: extract contract ID from submit-and-wait response
    // Response may have: events[], transactionEvents[], or contractId at root
    let contractId = null;
    
    console.log('[Create OrderBook] Response structure:', {
      hasEvents: !!result.events,
      hasTransactionEvents: !!result.transactionEvents,
      hasUpdateId: !!result.updateId,
      hasContractId: !!result.contractId,
      keys: Object.keys(result)
    });
    
    // Method 1: Check events array
    if (result.events && Array.isArray(result.events)) {
      for (const event of result.events) {
        if (event.created?.contractId) {
                    contractId = event.created.contractId;
          console.log(`[Create OrderBook] ✅ Contract ID from events: ${contractId.substring(0, 50)}...`);
                    break;
                  }
      }
    }
    
    // Method 2: Check transactionEvents
    if (!contractId && result.transactionEvents && Array.isArray(result.transactionEvents)) {
      for (const event of result.transactionEvents) {
        if (event.created?.contractId) {
                    contractId = event.created.contractId;
          console.log(`[Create OrderBook] ✅ Contract ID from transactionEvents: ${contractId.substring(0, 50)}...`);
                    break;
                  }
                }
              }
    
    // Method 3: Check root level
    if (!contractId && result.contractId) {
      contractId = result.contractId;
      console.log(`[Create OrderBook] ✅ Contract ID from root: ${contractId.substring(0, 50)}...`);
    }
    
    // Method 4: Query active contracts by operator party (most reliable after submit-and-wait)
    // submit-and-wait guarantees the transaction is committed, so the contract should be visible
    if (!contractId) {
      console.log(`[Create OrderBook] Querying active contracts for OrderBook: ${payload.tradingPair}`);
      try {
        // Extract packageId from templateIdToUse (format: packageId:Module:Template)
        const packageIdFromTemplate = templateIdToUse.split(':')[0];
        
        const activeAtOffset = await getActiveAtOffset(adminToken, result.completionOffset);
      
      const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            activeAtOffset: activeAtOffset,
          filter: {
              filtersByParty: {
                [operatorPartyId]: {
              inclusive: {
                    templateIds: [`${packageIdFromTemplate}:OrderBook:OrderBook`]
              }
            }
          }
            },
            verbose: true
        })
      });
      
      if (queryResponse.ok) {
        const queryData = await queryResponse.json();
          const contracts = queryData.activeContracts || queryData.result || queryData || [];
          const contractsArray = Array.isArray(contracts) ? contracts : [];
          console.log(`[Create OrderBook] Found ${contractsArray.length} active OrderBook contracts`);
          
          // Find the OrderBook for this trading pair
          for (const entry of contractsArray) {
            const contract = entry.activeContract || entry.contract || entry;
            if (contract?.contractId && contract?.templateId?.includes('OrderBook')) {
              const createArgs = contract.createArguments || contract.argument || {};
              if (createArgs.tradingPair === payload.tradingPair) {
                contractId = contract.contractId;
          console.log(`[Create OrderBook] ✅ Contract ID from active contracts: ${contractId.substring(0, 50)}...`);
                break;
              }
            }
          }
        } else {
          const errorText = await queryResponse.text();
          console.warn(`[Create OrderBook] Active contracts query failed: ${queryResponse.status}`, errorText.substring(0, 200));
        }
      } catch (queryError) {
        console.warn('[Create OrderBook] Error querying active contracts:', queryError.message);
      }
    }
    
    if (!contractId) {
      console.error('[Create OrderBook] Full response:', JSON.stringify(result, null, 2));
      throw new Error(`Failed to extract OrderBook contract ID. Response keys: ${Object.keys(result).join(', ')}`);
    }
    
    console.log(`[Create OrderBook] ✅ OrderBook created: ${contractId.substring(0, 30)}...`);
    
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

/**
 * Admin endpoint to upload DAR file
 * Uses the backend's working authentication to upload the DAR
 */
app.post('/api/admin/upload-dar', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Find DAR file
    const darPaths = [
      path.join(__dirname, '../.daml/dist/clob-exchange-utxo-1.0.0.dar'),
      path.join(__dirname, '../.daml/dist/clob-exchange-1.0.0.dar'),
      path.join(__dirname, '../daml/.daml/dist/clob-exchange-utxo-1.0.0.dar'),
      path.join(__dirname, '../daml/.daml/dist/clob-exchange-1.0.0.dar')
    ];
    
    let darFile = null;
    for (const darPath of darPaths) {
      if (fs.existsSync(darPath)) {
        darFile = darPath;
        break;
      }
    }
    
    if (!darFile) {
      return res.status(404).json({
        error: 'DAR file not found',
        searched: darPaths.map(p => path.relative(__dirname, p))
      });
    }
    
    console.log(`[Admin] Uploading DAR: ${darFile}`);
    
    // Get admin token
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    
    // Upload to Canton using gRPC (the working method)
    // For now, we'll use the JSON API v1 endpoint
    const CANTON_UPLOAD_URL = 'https://participant.dev.canton.wolfedgelabs.com/v1/packages';
    
    const darBuffer = fs.readFileSync(darFile);
    
    // Try JSON API first
    const response = await fetch(CANTON_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/octet-stream'
      },
      body: darBuffer
    });
    
    const responseText = await response.text();
    
    if (response.ok || response.status === 409) {
      console.log('[Admin] ✅ DAR uploaded successfully');
      return res.json({
        success: true,
        message: 'DAR uploaded successfully',
        status: response.status,
        response: responseText
      });
    } else {
      console.error('[Admin] ❌ DAR upload failed:', response.status, responseText);
      return res.status(response.status).json({
        error: 'DAR upload failed',
        status: response.status,
        response: responseText
      });
    }
  } catch (error) {
    console.error('[Admin] DAR upload error:', error);
    res.status(500).json({
      error: 'Failed to upload DAR',
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
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
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
    
    // Known package IDs from DAR uploads
    // PRIMARY: 51522c77... (confirmed working - OrderBooks are created with this)
    const knownPackageIds = [
      '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9', // PRIMARY - confirmed working, OrderBooks created with this
      '1aa4ed9b2bec34ef6764c882d76e3789a9bf3af77cc8e60ac903fea2e8aab215', // NEW - clob-exchange-utxo v1.0.0 with UTXO handling (has activeUsers field issue)
      'ebe9b93c1bd07c02de5635347a8bf1904bf96f7918b65136621bf61c16090e1e',
    ];
    
    try {
      console.log('[OrderBooks API] Querying ledger transaction events for all OrderBooks...');
      
      // Try querying with operator party filter
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
        console.log(`[OrderBooks API] Scanned ${updates.length} transaction events`);
        
        // Find all OrderBook creation events
        const orderBookMap = new Map(); // tradingPair -> most recent OrderBook
        
        // Search backwards to get most recent OrderBooks
        for (let i = updates.length - 1; i >= 0; i--) {
          const update = updates[i];
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.contractId) {
                const templateId = event.created.templateId || '';
                // Check if it's an OrderBook - try multiple patterns
                const isOrderBook = 
                  templateId.includes('OrderBook:OrderBook') ||
                  (templateId.includes('OrderBook') && knownPackageIds.some(pkgId => templateId.startsWith(pkgId)));
                
                if (isOrderBook) {
                  const createArgs = event.created.createArguments || event.created.argument;
                  const tradingPair = createArgs?.tradingPair;
                  if (tradingPair && !orderBookMap.has(tradingPair)) {
                    // Only add if we don't already have a more recent one for this pair
                    orderBookMap.set(tradingPair, {
                      tradingPair: tradingPair,
                      contractId: event.created.contractId,
                      templateId: templateId,
                      operator: createArgs?.operator || operatorPartyId,
                      buyOrdersCount: createArgs?.buyOrders?.length || 0,
                      sellOrdersCount: createArgs?.sellOrders?.length || 0,
                      lastPrice: createArgs?.lastPrice || null
                    });
                    console.log(`[OrderBooks API] Found OrderBook for ${tradingPair}: ${event.created.contractId.substring(0, 30)}...`);
                  }
                }
              }
            }
          }
        }
        
        orderBooksFromEvents = Array.from(orderBookMap.values());
        console.log(`[OrderBooks API] Found ${orderBooksFromEvents.length} OrderBooks in transaction events`);
      } else {
        const errorText = await updatesResponse.text();
        console.error('[OrderBooks API] Failed to query transaction events:', updatesResponse.status, errorText.substring(0, 200));
      }
    } catch (error) {
      console.error('[OrderBooks API] Error querying ledger for OrderBooks:', error.message);
    }
    
    // Also try querying Canton directly using known package IDs
    // Use the same knownPackageIds declared above (line 980)
    // Add detected package ID if different
    if (packageId && !knownPackageIds.includes(packageId)) {
      knownPackageIds.push(packageId);
    }
    
    let orderBooksFromQuery = [];
    
    // Try querying with each known package ID
    for (const pkgId of knownPackageIds) {
      try {
        const qualifiedTemplateId = `${pkgId}:OrderBook:OrderBook`;
        console.log(`[OrderBooks API] Trying to query with package ID: ${pkgId.substring(0, 16)}...`);
        
        const activeAtOffset = await getActiveAtOffset(adminToken);
        const requestBody = {
          activeAtOffset: activeAtOffset,
          verbose: true,
          filter: {
            filtersForAnyParty: {
              inclusive: {
                templateIds: [qualifiedTemplateId]
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
          
          const foundBooks = orderBooks
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
          
          if (foundBooks.length > 0) {
            orderBooksFromQuery.push(...foundBooks);
            console.log(`[OrderBooks API] ✅ Found ${foundBooks.length} OrderBooks using package ID ${pkgId.substring(0, 16)}...`);
            break; // Found OrderBooks, no need to try other package IDs
          } else {
            console.log(`[OrderBooks API] No OrderBooks found with package ${pkgId.substring(0, 16)}...`);
          }
        } else {
          const errorText = await response.text();
          console.log(`[OrderBooks API] Query with package ${pkgId.substring(0, 16)}... failed: ${response.status} - ${errorText.substring(0, 100)}`);
        }
      } catch (error) {
        console.warn(`[OrderBooks API] Error querying with package ${pkgId.substring(0, 16)}...:`, error.message);
      }
    }
    
    console.log(`[OrderBooks API] Total OrderBooks from query: ${orderBooksFromQuery.length}`);
    
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
 * PROFESSIONAL APPROACH: Query ledger directly for global OrderBook
 * No cache - query blockchain/ledger directly like Hyperliquid, Lighter, etc.
 * Uses Canton's transaction events API to find OrderBooks, then queries contracts directly
 * 
 * IMPORTANT: This route must come BEFORE /api/orderbooks/:tradingPair (more specific routes first)
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
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
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
        // Handle 413 error gracefully - too many transactions, fall back to direct query
        if (updatesResponse.status === 413) {
          console.warn('[Global OrderBook] Transaction scan hit 413 limit (too many transactions) - falling back to direct query');
          // Don't throw - let it fall through to direct query below
        } else {
          console.error('[Global OrderBook] Updates API error:', errorText);
          console.error('[Global OrderBook] Request body sent:', JSON.stringify(requestBody));
          // Don't throw - let it fall through to direct query below
        }
      } else {
      
        const updatesData = await updatesResponse.json();
        const updates = updatesData.updates || [];
        console.log(`[Global OrderBook] Scanned ${updates.length} transaction events from ledger`);
        
        // EXPERT FIX: Use template pattern matching instead of hardcoded package IDs
        // Search backwards through all transactions to find the most recent OrderBook for this trading pair
        for (let i = updates.length - 1; i >= 0; i--) {
          const update = updates[i];
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.contractId) {
                const templateId = event.created.templateId || '';
                // Check if it's an OrderBook - match by template name, not package ID
                const isOrderBook = templateId.includes('OrderBook:OrderBook') || 
                                    (templateId.includes('OrderBook') && templateId.split(':').length === 3);
                
                if (isOrderBook) {
                  const createArgs = event.created.createArguments || event.created.argument;
                  if (createArgs?.tradingPair === decodedTradingPair) {
                    orderBookContractId = event.created.contractId;
                    orderBookOperator = createArgs?.operator || operatorPartyId;
                    console.log(`[Global OrderBook] ✅ Found OrderBook in ledger: ${orderBookContractId.substring(0, 30)}...`);
                    break;
                  }
                }
              }
            }
            if (orderBookContractId) break;
          }
        }
      }
    } catch (err) {
      console.warn('[Global OrderBook] Transaction scan error:', err.message);
      // Don't throw - fall through to direct query
    }
    
    // EXPERT FIX: Always try direct query (most reliable, no 413 limit)
    // Use filtersByParty with operator party (works with admin token, filtersForAnyParty requires different permissions)
    if (!orderBookContractId) {
      console.log('[Global OrderBook] Trying direct active contracts query (most reliable)...');
      
      try {
        // Use filtersByParty with operator party - this works with admin token
        const activeAtOffset = await getActiveAtOffset(adminToken);
        const directQueryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            activeAtOffset: activeAtOffset,
            verbose: true,
            filter: {
              filtersByParty: {
                [operatorPartyId]: {
                  inclusive: {
                    templateIds: ['OrderBook:OrderBook'] // Unqualified - matches any package
                  }
                }
              }
            }
          })
        });
        
        if (directQueryResponse.ok) {
          const directQueryData = await directQueryResponse.json();
          const contracts = Array.isArray(directQueryData) ? directQueryData : (directQueryData.activeContracts || []);
          
          console.log(`[Global OrderBook] Found ${contracts.length} active OrderBook contracts`);
          
          // Find OrderBook for this trading pair
          for (const contract of contracts) {
            const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                               contract.createdEvent || 
                               contract;
            const createArgs = contractData.createArgument || contractData.argument || {};
            
            if (createArgs.tradingPair === decodedTradingPair) {
              orderBookContractId = contractData.contractId;
              orderBookOperator = createArgs.operator || operatorPartyId;
              console.log(`[Global OrderBook] ✅ Found OrderBook via direct query: ${orderBookContractId.substring(0, 30)}...`);
              break;
            }
          }
        } else {
          const errorText = await directQueryResponse.text();
          console.warn('[Global OrderBook] Direct query failed:', directQueryResponse.status, errorText.substring(0, 200));
        }
      } catch (err) {
        console.warn('[Global OrderBook] Direct query error:', err.message);
      }
    }
    
    // If still not found, return empty orders (OrderBook doesn't exist yet - will be created on first order)
    if (!orderBookContractId) {
      console.log(`[Global OrderBook] OrderBook not found for ${decodedTradingPair} - will be created on first order`);
      return res.json({
        success: true,
        tradingPair: decodedTradingPair,
        orders: {
          buys: [],
          sells: []
        },
        buyOrders: [],
        sellOrders: [],
        buyOrdersCount: 0,
        sellOrdersCount: 0,
        lastPrice: null,
        message: 'OrderBook not found - will be created on first order'
      });
    }
    
    if (!orderBookContractId) {
      // Return empty orders array instead of 404 - OrderBook will be created when first order is placed
      return res.json({
        success: true,
        tradingPair: decodedTradingPair,
        orders: {
          buys: [],
          sells: []
        },
        message: 'OrderBook not found - will be created on first order'
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
      const activeAtOffset5 = await getActiveAtOffset(adminToken);
      orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: activeAtOffset5,
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
        const activeAtOffset6 = await getActiveAtOffset(adminToken);
        orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            readAs: [operatorPartyId],
            activeAtOffset: activeAtOffset6,
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
                      const activeAtOffset7 = await getActiveAtOffset(adminToken);
                      const ordersResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${adminToken}`
                        },
                        body: JSON.stringify({
                          activeAtOffset: activeAtOffset7,
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
        
        const activeAtOffset8 = await getActiveAtOffset(adminToken);
        const ordersResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            readAs: [operatorPartyId],
            activeAtOffset: activeAtOffset8,
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
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    // Get the OrderBook contract ID for this trading pair
    const { getOrderBookContractId } = require('./canton-api-helpers');
    const orderBookContractId = await getOrderBookContractId(tradingPair, adminToken, CANTON_JSON_API_BASE);
    
    if (!orderBookContractId) {
      // Return success instead of 404 - OrderBook will be created on first order
      return res.json({
        success: true,
        tradingPair,
        message: 'OrderBook not found - will be created on first order'
      });
    }
    
    // Fetch current OrderBook to get userAccounts map
    const activeAtOffset9 = await getActiveAtOffset(adminToken);
    const orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        readAs: [operatorPartyId],
        activeAtOffset: activeAtOffset9,
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
 * TESTNET: Create UserAccount and add test tokens
 * This endpoint creates a UserAccount for a user and adds test tokens for testing
 */
app.post('/api/testnet/mint-tokens', async (req, res) => {
  try {
    const { partyId } = req.body;
    
    if (!partyId) {
      return res.status(400).json({
        error: 'Missing partyId',
        required: ['partyId']
      });
    }
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    console.log(`[Testnet] Creating UserAccount and minting test tokens for: ${partyId}`);
    
    // Check if UserAccount already exists
    const UTXOHandler = require('./utxo-handler');
    const utxoHandler = new UTXOHandler();
    let userAccount = await utxoHandler.getUserAccount(partyId, adminToken);
    
    // Test token amounts (generous for testing)
    // DAML Map.Map Text Decimal is serialized as array of [key, value] pairs
    const testBalances = [
      ['USDT', '100000.0'],  // 100k USDT
      ['BTC', '10.0'],       // 10 BTC
      ['ETH', '100.0'],      // 100 ETH
      ['SOL', '1000.0'],     // 1000 SOL
      ['BNB', '500.0'],      // 500 BNB
      ['ADA', '5000.0']      // 5000 ADA
    ];
    
    let userAccountContractId = null;
    
    if (!userAccount) {
      // Create UserAccount with initial test balances
      console.log('[Testnet] Creating new UserAccount with test balances...');
      
      // Discover template ID
      let templateIdToUse = null;
      try {
        const activeAtOffset = await getActiveAtOffset(adminToken);
        const existingQuery = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            activeAtOffset: activeAtOffset,
            verbose: true,
            filter: {
              filtersForAnyParty: {
                inclusive: {
                  templateIds: ['UserAccount:UserAccount']
                }
              }
            }
          })
        });
        
        if (existingQuery.ok) {
          const existingData = await existingQuery.json();
          const contracts = Array.isArray(existingData) ? existingData : (existingData.activeContracts || []);
          if (contracts.length > 0) {
            const contract = contracts[0];
            const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                                contract.createdEvent || 
                                contract;
            templateIdToUse = contractData.templateId;
            console.log('[Testnet] Discovered UserAccount template:', templateIdToUse);
          }
        }
      } catch (e) {
        console.warn('[Testnet] Template discovery failed:', e.message);
      }
      
      // Fallback to known package ID
      if (!templateIdToUse) {
        const WORKING_PACKAGE_ID = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
        templateIdToUse = `${WORKING_PACKAGE_ID}:UserAccount:UserAccount`;
      }
      
      // Create UserAccount
      const commandId = `create-useraccount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const createResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          commandId: commandId,
          commands: [{
            CreateCommand: {
              templateId: templateIdToUse,
              createArguments: {
                party: partyId,
                balances: testBalances,
                operator: operatorPartyId
              }
            }
          }],
          actAs: [operatorPartyId]
        })
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[Testnet] Failed to create UserAccount:', createResponse.status, errorText);
        return res.status(createResponse.status).json({
          error: 'Failed to create UserAccount',
          details: errorText
        });
      }
      
      const createResult = await createResponse.json();
      console.log('[Testnet] UserAccount created successfully');
      
      // Get contract ID from response
      if (createResult.events && Array.isArray(createResult.events)) {
        const createdEvent = createResult.events.find(e => e.created);
        if (createdEvent && createdEvent.created && createdEvent.created.contractId) {
          userAccountContractId = createdEvent.created.contractId;
        }
      }
      
      // If not in events, query active contracts by party (most reliable after submit-and-wait)
      // submit-and-wait guarantees the transaction is committed, so the contract should be visible
      if (!userAccountContractId) {
        console.log('[Testnet] Contract ID not in response, querying active contracts by party...');
        
        // Query using party filter - more reliable than filtersForAnyParty
        try {
          const activeAtOffset = await getActiveAtOffset(adminToken, createResult.completionOffset);
          const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              activeAtOffset: activeAtOffset,
              verbose: true,
              filter: {
                filtersByParty: {
                  [partyId]: {
                    inclusive: {
                      templateIds: ['UserAccount:UserAccount']
                    }
                  }
                }
              }
            })
          });
          
          if (queryResponse.ok) {
            const queryData = await queryResponse.json();
            const contracts = Array.isArray(queryData) ? queryData : (queryData.activeContracts || []);
            
            // Find UserAccount for this party
            for (const contract of contracts) {
              const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                                  contract.createdEvent || 
                                  contract;
              const createArgs = contractData.createArgument || contractData.argument || {};
              
              if (createArgs.party === partyId) {
                userAccountContractId = contractData.contractId;
                console.log(`[Testnet] ✅ Found UserAccount contract ID: ${userAccountContractId.substring(0, 50)}...`);
                break;
              }
            }
          } else {
            const errorText = await queryResponse.text();
            console.warn('[Testnet] Active contracts query failed:', queryResponse.status, errorText.substring(0, 200));
          }
        } catch (queryErr) {
          console.warn('[Testnet] Error querying active contracts:', queryErr.message);
        }
      }
      
      // If still not found, try using UTXOHandler to get it
      if (!userAccountContractId) {
        console.log('[Testnet] Trying UTXOHandler to get UserAccount...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const fetchedAccount = await utxoHandler.getUserAccount(partyId, adminToken);
        if (fetchedAccount && fetchedAccount.contractId) {
          userAccountContractId = fetchedAccount.contractId;
          console.log(`[Testnet] ✅ Got UserAccount from UTXOHandler: ${userAccountContractId.substring(0, 50)}...`);
        }
      }
      
      if (!userAccountContractId) {
        // Don't fail - UserAccount was created, just return success without contract ID
        console.warn('[Testnet] ⚠️ UserAccount created but contract ID not immediately retrievable');
        console.warn('[Testnet] This is OK - contract will be queryable shortly. updateId:', createResult.updateId);
        
        // Return success with test balances so frontend can use them immediately
        // Convert testBalances array to object for response
        const balancesObj = {};
        testBalances.forEach(([key, value]) => {
          balancesObj[key] = value;
        });
        
        return res.json({
          success: true,
          message: 'UserAccount created successfully (contract ID will be available shortly)',
          partyId,
          userAccountContractId: null,
          balances: balancesObj, // Return test balances so frontend can use them immediately
          updateId: createResult.updateId,
          completionOffset: createResult.completionOffset,
          note: 'UserAccount was created. Balances shown are from creation.'
        });
      }
      
      console.log(`[Testnet] ✅ UserAccount created: ${userAccountContractId.substring(0, 50)}...`);
      
    } else {
      // UserAccount exists - add more tokens via Deposit
      console.log('[Testnet] UserAccount exists, adding test tokens via Deposit...');
      userAccountContractId = userAccount.contractId;
      
      // Discover template ID
      let templateIdToUse = userAccount.contractId.split('#')[0] || null;
      if (!templateIdToUse) {
        const WORKING_PACKAGE_ID = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
        templateIdToUse = `${WORKING_PACKAGE_ID}:UserAccount:UserAccount`;
      }
      
      // Deposit each token (testBalances is array of [key, value] pairs)
      for (const [token, amount] of testBalances) {
        try {
          const commandId = `deposit-${token}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const depositResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
              commandId: commandId,
              commands: [{
                ExerciseCommand: {
                  contractId: userAccountContractId,
                  choice: 'Deposit',
                  argument: {
                    token: token,
                    amount: amount
                  }
                }
              }],
              actAs: [partyId]
            })
          });
          
          if (depositResponse.ok) {
            console.log(`[Testnet] ✅ Deposited ${amount} ${token}`);
          } else {
            const errorText = await depositResponse.text();
            console.warn(`[Testnet] Failed to deposit ${token}:`, depositResponse.status, errorText.substring(0, 200));
          }
        } catch (e) {
          console.warn(`[Testnet] Error depositing ${token}:`, e.message);
        }
      }
    }
    
    // Get updated balances
    userAccount = await utxoHandler.getUserAccount(partyId, adminToken);
    
    // Convert balances array to object for response
    let balancesObj = {};
    if (userAccount?.balances) {
      if (Array.isArray(userAccount.balances)) {
        userAccount.balances.forEach(([key, value]) => {
          balancesObj[key] = value;
        });
      } else if (typeof userAccount.balances === 'object') {
        balancesObj = userAccount.balances;
      }
    } else {
      // Convert testBalances array to object
      testBalances.forEach(([key, value]) => {
        balancesObj[key] = value;
      });
    }
    
    res.json({
      success: true,
      message: 'Test tokens minted successfully',
      partyId,
      userAccountContractId,
      balances: balancesObj,
      note: 'This is a testnet endpoint. Tokens are for testing only.'
    });
    
  } catch (error) {
    console.error('[Testnet Mint] Error:', error);
    res.status(500).json({
      error: 'Failed to mint test tokens',
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
 * UTXO-aware order placement endpoint
 * Handles UTXO merging before placing orders and places the order
 * This solves the UTXO fragmentation problem in Canton
 */
app.post('/api/orders/place', async (req, res) => {
  try {
    const { partyId, tradingPair, orderType, orderMode, quantity, price, orderBookContractId, userAccountContractId } = req.body;
    
    if (!partyId || !tradingPair || !orderType || !quantity) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['partyId', 'tradingPair', 'orderType', 'quantity']
      });
    }
    
    // TESTNET: Auto-create UserAccount with test tokens if it doesn't exist
    const UTXOHandler = require('./utxo-handler');
    const utxoHandler = new UTXOHandler();
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    let finalUserAccountContractId = userAccountContractId;
    let userAccount = await utxoHandler.getUserAccount(partyId, adminToken);
    
    if (!userAccount) {
      console.log(`[Order Place] UserAccount not found for ${partyId}, auto-creating with test tokens...`);
      
      try {
        // Create UserAccount with test balances inline
        const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
          '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
        const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
        
        // DAML Map.Map Text Decimal is serialized as array of [key, value] pairs
        const testBalances = [
          ['USDT', '100000.0'],
          ['BTC', '10.0'],
          ['ETH', '100.0'],
          ['SOL', '1000.0'],
          ['BNB', '500.0'],
          ['ADA', '5000.0']
        ];
        
        // Discover template ID
        let templateIdToUse = null;
        try {
          const activeAtOffset = await getActiveAtOffset(adminToken);
          const existingQuery = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              activeAtOffset: activeAtOffset,
              verbose: true,
              filter: {
                filtersForAnyParty: {
                  inclusive: {
                    templateIds: ['UserAccount:UserAccount']
                  }
                }
              }
            })
          });
          
          if (existingQuery.ok) {
            const existingData = await existingQuery.json();
            const contracts = Array.isArray(existingData) ? existingData : (existingData.activeContracts || []);
            if (contracts.length > 0) {
              const contract = contracts[0];
              const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                                  contract.createdEvent || 
                                  contract;
              templateIdToUse = contractData.templateId;
            }
          }
        } catch (e) {
          console.warn('[Order Place] Template discovery failed:', e.message);
        }
        
        if (!templateIdToUse) {
          const WORKING_PACKAGE_ID = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
          templateIdToUse = `${WORKING_PACKAGE_ID}:UserAccount:UserAccount`;
        }
        
        // Create UserAccount
        const commandId = `create-useraccount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const createResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            commandId: commandId,
            commands: [{
              CreateCommand: {
                templateId: templateIdToUse,
                createArguments: {
                  party: partyId,
                  balances: testBalances,
                  operator: operatorPartyId
                }
              }
            }],
            actAs: [operatorPartyId]
          })
        });
        
        if (createResponse.ok) {
          const createResult = await createResponse.json();
          
          // Per Sync Global scan API: extract contract ID from response
          // Check multiple possible response structures
          console.log('[Order Place] UserAccount create response structure:', {
            hasEvents: !!createResult.events,
            hasTransactionEvents: !!createResult.transactionEvents,
            hasUpdateId: !!createResult.updateId,
            keys: Object.keys(createResult)
          });
          
          // Method 1: Check events array - extract contract ID and balances from creation response
          if (createResult.events && Array.isArray(createResult.events)) {
            for (const event of createResult.events) {
              if (event.created?.contractId) {
                finalUserAccountContractId = event.created.contractId;
                // Extract balances from createArguments if available
                const createArgs = event.created.createArguments || event.created.argument || {};
                if (createArgs.balances) {
                  // Store balances for use in order placement (no query needed)
                  userAccount = {
                    contractId: finalUserAccountContractId,
                    balances: createArgs.balances,
                    party: partyId
                  };
                }
                console.log(`[Order Place] ✅ UserAccount contract ID from events: ${finalUserAccountContractId.substring(0, 50)}...`);
                break;
              }
            }
          }
          
          // Method 2: Check transactionEvents
          if (!finalUserAccountContractId && createResult.transactionEvents && Array.isArray(createResult.transactionEvents)) {
            for (const event of createResult.transactionEvents) {
              if (event.created?.contractId) {
                finalUserAccountContractId = event.created.contractId;
                const createArgs = event.created.createArguments || event.created.argument || {};
                if (createArgs.balances) {
                  userAccount = {
                    contractId: finalUserAccountContractId,
                    balances: createArgs.balances,
                    party: partyId
                  };
                }
                console.log(`[Order Place] ✅ UserAccount contract ID from transactionEvents: ${finalUserAccountContractId.substring(0, 50)}...`);
                break;
              }
            }
          }
          
          // Method 3: Check root level
          if (!finalUserAccountContractId && createResult.contractId) {
            finalUserAccountContractId = createResult.contractId;
            console.log(`[Order Place] ✅ UserAccount contract ID from root: ${finalUserAccountContractId.substring(0, 50)}...`);
          }
          
          // Method 4: Query active contracts by party (most reliable after submit-and-wait)
          // submit-and-wait guarantees the transaction is committed, so the contract should be visible
          if (!finalUserAccountContractId) {
            console.log(`[Order Place] Querying active contracts for UserAccount by party: ${partyId}`);
            try {
              // Extract packageId from templateIdToUse (format: packageId:Module:Template)
              const packageIdFromTemplate = templateIdToUse.split(':')[0];
              
              const activeAtOffset = await getActiveAtOffset(adminToken, createResult.completionOffset);
              
              const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${adminToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  activeAtOffset: activeAtOffset,
                  filter: {
                    filtersByParty: {
                      [partyId]: {
                        inclusive: {
                          templateIds: [`${packageIdFromTemplate}:UserAccount:UserAccount`]
                        }
                      }
                    }
                  },
                  verbose: true
                })
              });
              
              if (queryResponse.ok) {
                const queryData = await queryResponse.json();
                const contracts = queryData.activeContracts || queryData.result || queryData || [];
                const contractsArray = Array.isArray(contracts) ? contracts : [];
                console.log(`[Order Place] Found ${contractsArray.length} active UserAccount contracts`);
                
                // Find the UserAccount for this party
                for (const entry of contractsArray) {
                  const contract = entry.activeContract || entry.contract || entry;
                  if (contract?.contractId && contract?.templateId?.includes('UserAccount')) {
                    const createArgs = contract.createArguments || contract.argument || {};
                    if (createArgs.party === partyId) {
                      finalUserAccountContractId = contract.contractId;
                      userAccount = {
                        contractId: finalUserAccountContractId,
                        balances: createArgs.balances || testBalances,
                        party: partyId
                      };
                      console.log(`[Order Place] ✅ UserAccount contract ID from active contracts: ${finalUserAccountContractId.substring(0, 50)}...`);
                      break;
                    }
                  }
                }
          } else {
                const errorText = await queryResponse.text();
                console.warn(`[Order Place] Active contracts query failed: ${queryResponse.status}`, errorText.substring(0, 200));
              }
            } catch (queryError) {
              console.warn('[Order Place] Error querying active contracts:', queryError.message);
            }
          }
          
          if (!finalUserAccountContractId) {
            console.error('[Order Place] Full UserAccount response:', JSON.stringify(createResult, null, 2));
            throw new Error(`Failed to extract UserAccount contract ID. Response keys: ${Object.keys(createResult).join(', ')}`);
          }
          
          // If we have contract ID but no userAccount object, construct it with test balances
          if (finalUserAccountContractId && !userAccount) {
            userAccount = {
              contractId: finalUserAccountContractId,
              balances: testBalances, // Use the balances we created it with
              party: partyId
            };
            console.log(`[Order Place] Constructed UserAccount object from creation response`);
          }
        } else {
          const errorText = await createResponse.text();
          console.warn(`[Order Place] Failed to auto-create UserAccount: ${createResponse.status}`, errorText.substring(0, 200));
        }
      } catch (e) {
        console.warn('[Order Place] Error auto-creating UserAccount:', e.message);
        // Continue - order service will handle the error
      }
    } else {
      finalUserAccountContractId = userAccount.contractId;
    }

    // AUTO-CREATE OrderBook if it doesn't exist
    let finalOrderBookContractId = orderBookContractId;
    
    if (!finalOrderBookContractId || finalOrderBookContractId === 'null' || finalOrderBookContractId === '') {
      console.log(`[Order Place] OrderBook not provided, checking if it exists for ${tradingPair}...`);
      
      // Check if OrderBook exists
      try {
        const activeAtOffset = await getActiveAtOffset(adminToken);
        const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            activeAtOffset: activeAtOffset,
            verbose: true,
            filter: {
              filtersByParty: {
                [operatorPartyId]: {
                  inclusive: {
                    templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']
                  }
                }
              }
            }
          })
        });
        
        if (queryResponse.ok) {
          const queryData = await queryResponse.json();
          const contracts = Array.isArray(queryData) ? queryData : (queryData.activeContracts || []);
          
          // Find OrderBook for this trading pair
          for (const contract of contracts) {
            const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                               contract.createdEvent || 
                               contract;
            const createArgs = contractData.createArgument || contractData.argument || {};
            
            if (createArgs.tradingPair === tradingPair) {
              finalOrderBookContractId = contractData.contractId;
              console.log(`[Order Place] ✅ Found existing OrderBook: ${finalOrderBookContractId.substring(0, 30)}...`);
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[Order Place] Error checking for OrderBook:', e.message);
      }
      
      // If still not found, create it
      if (!finalOrderBookContractId || finalOrderBookContractId === 'null' || finalOrderBookContractId === '') {
        console.log(`[Order Place] OrderBook not found, auto-creating for ${tradingPair}...`);
        
        try {
          // Use the admin endpoint logic to create OrderBook
          const WORKING_PACKAGE_ID = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
          const templateIdToUse = `${WORKING_PACKAGE_ID}:OrderBook:OrderBook`;
          
          const commandId = `create-orderbook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const createResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
              commandId: commandId,
              commands: [{
                CreateCommand: {
                  templateId: templateIdToUse,
                  createArguments: {
                    tradingPair: tradingPair,
                    buyOrders: [],
                    sellOrders: [],
                    operator: operatorPartyId,
                    lastPrice: null,
                    userAccounts: null
                  }
                }
              }],
              actAs: [operatorPartyId]
            })
          });
          
          if (createResponse.ok) {
            const createResult = await createResponse.json();
            
            // Per Sync Global scan API: extract contract ID from response
            // Response structure: { updateId, completionOffset, events: [{ created: { contractId } }] }
            // Or: { transactionEvents: [{ created: { contractId } }] }
            // Or: events at root level
            console.log('[Order Place] Create response structure:', {
              hasEvents: !!createResult.events,
              hasTransactionEvents: !!createResult.transactionEvents,
              hasUpdateId: !!createResult.updateId,
              keys: Object.keys(createResult)
            });
            
            // Method 1: Check events array (most common)
            if (createResult.events && Array.isArray(createResult.events)) {
              for (const event of createResult.events) {
                if (event.created?.contractId) {
                  finalOrderBookContractId = event.created.contractId;
                  console.log(`[Order Place] ✅ OrderBook contract ID from events: ${finalOrderBookContractId.substring(0, 50)}...`);
                  break;
                }
              }
            }
            
            // Method 2: Check transactionEvents
            if (!finalOrderBookContractId && createResult.transactionEvents && Array.isArray(createResult.transactionEvents)) {
              for (const event of createResult.transactionEvents) {
                if (event.created?.contractId) {
                          finalOrderBookContractId = event.created.contractId;
                  console.log(`[Order Place] ✅ OrderBook contract ID from transactionEvents: ${finalOrderBookContractId.substring(0, 50)}...`);
                          break;
                        }
                      }
                    }
            
            // Method 3: Check if contractId is at root level (some API versions)
            if (!finalOrderBookContractId && createResult.contractId) {
              finalOrderBookContractId = createResult.contractId;
              console.log(`[Order Place] ✅ OrderBook contract ID from root: ${finalOrderBookContractId.substring(0, 50)}...`);
            }
            
            // Method 4: Query active contracts by operator party (most reliable after submit-and-wait)
            // submit-and-wait guarantees the transaction is committed, so the contract should be visible
            if (!finalOrderBookContractId) {
              console.log(`[Order Place] Querying active contracts for OrderBook: ${tradingPair}`);
              try {
                const activeAtOffset = await getActiveAtOffset(adminToken, createResult.completionOffset);
                
              const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${adminToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    activeAtOffset: activeAtOffset,
                  filter: {
                    filtersByParty: {
                      [operatorPartyId]: {
                        inclusive: {
                            templateIds: [`${WORKING_PACKAGE_ID}:OrderBook:OrderBook`]
                        }
                      }
                    }
                    },
                    verbose: true
                })
              });
              
              if (queryResponse.ok) {
                const queryData = await queryResponse.json();
                const contracts = queryData.activeContracts || queryData.result || queryData || [];
                const contractsArray = Array.isArray(contracts) ? contracts : [];
                console.log(`[Order Place] Found ${contractsArray.length} active OrderBook contracts`);
                
                // Find the OrderBook for this trading pair
                for (const entry of contractsArray) {
                  const contract = entry.activeContract || entry.contract || entry;
                  if (contract?.contractId && contract?.templateId?.includes('OrderBook')) {
                    const createArgs = contract.createArguments || contract.argument || {};
                  if (createArgs.tradingPair === tradingPair) {
                      finalOrderBookContractId = contract.contractId;
                      console.log(`[Order Place] ✅ OrderBook contract ID from active contracts: ${finalOrderBookContractId.substring(0, 50)}...`);
                    break;
                  }
                }
              }
              } else {
                const errorText = await queryResponse.text();
                console.warn(`[Order Place] Active contracts query failed: ${queryResponse.status}`, errorText.substring(0, 200));
              }
              } catch (queryError) {
                console.warn('[Order Place] Error querying active contracts:', queryError.message);
              }
            }
            
            if (!finalOrderBookContractId) {
              console.error('[Order Place] Full response:', JSON.stringify(createResult, null, 2));
              throw new Error(`Failed to extract OrderBook contract ID. Response keys: ${Object.keys(createResult).join(', ')}`);
            }
          } else {
            const errorText = await createResponse.text();
            console.error(`[Order Place] Failed to create OrderBook: ${createResponse.status}`, errorText.substring(0, 200));
            throw new Error(`Failed to create OrderBook: ${errorText.substring(0, 200)}`);
          }
        } catch (e) {
          console.error('[Order Place] Error auto-creating OrderBook:', e.message);
          return res.status(500).json({
            error: 'Failed to create OrderBook',
            message: e.message
          });
        }
      }
    }

    // Use OrderService to place order with UTXO handling
    const result = await orderService.placeOrderWithUTXOHandling(
      partyId,
      tradingPair,
      orderType,
      orderMode || 'LIMIT',
      quantity,
      price,
      finalOrderBookContractId,
      finalUserAccountContractId || userAccountContractId
    );

    res.json({
      success: true,
      message: 'Order placed successfully with UTXO handling',
      ...result
    });
  } catch (error) {
    console.error('[Order Placement] Error:', error);
    res.status(500).json({
      error: 'Failed to place order',
      message: error.message 
    });
  }
});

/**
 * UTXO-aware order cancellation endpoint
 * Handles order cancellation and UTXO merging
 */
app.post('/api/orders/cancel', async (req, res) => {
  try {
    const { partyId, tradingPair, orderType, orderContractId, orderBookContractId, userAccountContractId } = req.body;
    
    if (!partyId || !tradingPair || !orderType || !orderContractId || !userAccountContractId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['partyId', 'tradingPair', 'orderType', 'orderContractId', 'userAccountContractId']
      });
    }

    // Use OrderService to cancel order with UTXO handling
    const result = await orderService.cancelOrderWithUTXOHandling(
      partyId,
      tradingPair,
      orderType,
      orderContractId,
      orderBookContractId,
      userAccountContractId
    );

    res.json({
      success: true,
      message: 'Order cancelled successfully with UTXO handling',
      ...result
    });
  } catch (error) {
    console.error('[Order Cancellation] Error:', error);
    res.status(500).json({
      error: 'Failed to cancel order',
      message: error.message 
    });
  }
});

/**
 * Matchmaking endpoint with UTXO handling
 * Called after orders are matched to handle UTXO merging for partial fills
 */
app.post('/api/orders/matchmaking-utxo', async (req, res) => {
  try {
    const { 
      buyerPartyId, 
      sellerPartyId, 
      tradingPair, 
      buyOrderType, 
      sellOrderType,
      buyRemainingQuantity,
      sellRemainingQuantity,
      buyerUserAccountId,
      sellerUserAccountId
    } = req.body;
    
    if (!buyerPartyId || !sellerPartyId || !tradingPair) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['buyerPartyId', 'sellerPartyId', 'tradingPair']
      });
    }

    // Use OrderService to handle matchmaking UTXO merging
    const result = await orderService.handleMatchmakingWithUTXO(
      buyerPartyId,
      sellerPartyId,
      tradingPair,
      buyOrderType || 'BUY',
      sellOrderType || 'SELL',
      buyRemainingQuantity || 0,
      sellRemainingQuantity || 0,
      buyerUserAccountId,
      sellerUserAccountId
    );

    res.json({
      success: true,
      message: 'Matchmaking UTXO handling completed',
      ...result
    });
  } catch (error) {
    console.error('[Matchmaking UTXO] Error:', error);
    res.status(500).json({
      error: 'Failed to handle matchmaking UTXO',
      message: error.message 
    });
  }
});

/**
 * Get all trades (global view) - shows ALL trades across ALL users
 * This is like Binance's "Recent Trades" panel
 */
app.get('/api/trades', async (req, res) => {
  try {
    const { tradingPair, limit = 50 } = req.query;
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    console.log(`[Global Trades] Fetching trades for ${tradingPair || 'all pairs'}...`);

    // Query Trade contracts from Canton using transaction events API
    // This is the professional approach - scan ledger for all Trade creation events
    let trades = [];
    
    try {
      const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          beginExclusive: 0,
          endInclusive: null,
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: [] // Empty array means match all templates
                }
              }
            }
          },
          verbose: true
        })
      });

      if (updatesResponse.ok) {
        const updatesData = await updatesResponse.json();
        const updates = updatesData.updates || [];
        
        // Extract all Trade creation events
        for (const update of updates) {
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.templateId?.includes('Trade')) {
                const createArgs = event.created.createArguments || event.created.argument;
                if (createArgs) {
                  trades.push({
                    tradeId: event.created.contractId,
                    tradingPair: createArgs.tradingPair,
                    price: parseFloat(createArgs.price || 0),
                    quantity: parseFloat(createArgs.quantity || 0),
                    timestamp: createArgs.timestamp,
                    buyer: createArgs.buyer,
                    seller: createArgs.seller,
                    buyOrderId: createArgs.buyOrderId,
                    sellOrderId: createArgs.sellOrderId
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[Global Trades] Error querying trades from ledger:', error.message);
    }

    // Filter by trading pair if specified
    if (tradingPair) {
      trades = trades.filter(t => t.tradingPair === tradingPair);
    }

    // Sort by timestamp (most recent first)
    trades.sort((a, b) => {
      // Handle different timestamp formats
      const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : (a.timestamp || 0);
      const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : (b.timestamp || 0);
      return timeB - timeA;
    });

    // Limit results
    const limitNum = parseInt(limit);
    trades = trades.slice(0, limitNum);

    // Format trades for frontend
    const formattedTrades = trades.map(trade => ({
      tradeId: trade.tradeId,
      tradingPair: trade.tradingPair,
      price: trade.price,
      quantity: trade.quantity,
      side: 'BUY', // Default to BUY (we can determine from buyer/seller if needed)
      timestamp: trade.timestamp,
      buyer: trade.buyer,
      seller: trade.seller,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId
    }));

    console.log(`[Global Trades] Returning ${formattedTrades.length} trades`);

    res.json({
      success: true,
      trades: formattedTrades,
      total: formattedTrades.length,
      tradingPair: tradingPair || 'all'
    });

  } catch (error) {
    console.error('[Global Trades] Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch trades',
      message: error.message 
    });
  }
});

/**
 * Get trades for specific trading pair (convenience endpoint)
 */
app.get('/api/orderbooks/:tradingPair/trades', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    const { limit = 50 } = req.query;
    
    // Forward to main trades endpoint with trading pair filter
    req.query.tradingPair = tradingPair;
    req.query.limit = limit;
    
    // Call the main trades endpoint logic
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
      '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    let trades = [];
    
    try {
      const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          beginExclusive: 0,
          endInclusive: null,
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: []
                }
              }
            }
          },
          verbose: true
        })
      });

      if (updatesResponse.ok) {
        const updatesData = await updatesResponse.json();
        const updates = updatesData.updates || [];
        
        for (const update of updates) {
          if (update.transaction && update.transaction.events) {
            for (const event of update.transaction.events) {
              if (event.created && event.created.templateId?.includes('Trade')) {
                const createArgs = event.created.createArguments || event.created.argument;
                if (createArgs && createArgs.tradingPair === tradingPair) {
                  trades.push({
                    tradeId: event.created.contractId,
                    tradingPair: createArgs.tradingPair,
                    price: parseFloat(createArgs.price || 0),
                    quantity: parseFloat(createArgs.quantity || 0),
                    timestamp: createArgs.timestamp,
                    buyer: createArgs.buyer,
                    seller: createArgs.seller
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[Trades] Error:', error);
    }

    trades.sort((a, b) => {
      const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : (a.timestamp || 0);
      const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : (b.timestamp || 0);
      return timeB - timeA;
    });

    const limitNum = parseInt(limit);
    trades = trades.slice(0, limitNum);

    const formattedTrades = trades.map(trade => ({
      tradeId: trade.tradeId,
      tradingPair: trade.tradingPair,
      price: trade.price,
      quantity: trade.quantity,
      side: 'BUY',
      timestamp: trade.timestamp,
      buyer: trade.buyer,
      seller: trade.seller
    }));

    res.json({
      success: true,
      trades: formattedTrades,
      total: formattedTrades.length,
      tradingPair
    });

  } catch (error) {
    console.error('[Trades] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/orderbooks/:tradingPair - Get OrderBook contract info
 * Returns OrderBook contract ID and metadata (used by frontend to check if OrderBook exists)
 * 
 * IMPORTANT: This route must come AFTER /api/orderbooks/:tradingPair/orders and /api/orderbooks/:tradingPair/trades
 * (general routes come after specific routes in Express)
 */
app.get('/api/orderbooks/:tradingPair', async (req, res) => {
  try {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);
    
    const cantonAdmin = new (require('./canton-admin'))();
    const adminToken = await cantonAdmin.getAdminToken();
    const operatorPartyId = process.env.CANTON_OPERATOR_PARTY_ID || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
    
    const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
    
    // Find OrderBook contract ID
    let orderBookContractId = null;
    let orderBookOperator = operatorPartyId;
    
    // PRIORITIZE direct query (most reliable, no 413 limit)
    // Use filtersByParty with operator party (works with admin token)
    try {
      const activeAtOffset10 = await getActiveAtOffset(adminToken);
      const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activeAtOffset: activeAtOffset10,
          verbose: true,
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
        const contracts = Array.isArray(queryData) ? queryData : (queryData.activeContracts || []);
        
        console.log(`[OrderBook] Found ${contracts.length} active OrderBook contracts`);
        
        for (const contract of contracts) {
          const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                             contract.createdEvent || 
                             contract;
          const createArgs = contractData.createArgument || contractData.argument || {};
          
          if (createArgs.tradingPair === decodedTradingPair) {
            orderBookContractId = contractData.contractId;
            orderBookOperator = createArgs.operator || operatorPartyId;
            console.log(`[OrderBook] ✅ Found OrderBook: ${orderBookContractId.substring(0, 30)}...`);
            break;
          }
        }
      } else {
        const errorText = await queryResponse.text();
        console.warn('[OrderBook] Direct query failed:', queryResponse.status, errorText.substring(0, 200));
      }
    } catch (err) {
      console.warn('[OrderBook] Error querying active contracts:', err.message);
    }
    
    if (!orderBookContractId) {
      // Return 200 with success:false (not 404) - professional trading platforms don't use 404 for missing orderbooks
      return res.json({
        success: false,
        error: 'OrderBook not found',
        tradingPair: decodedTradingPair,
        message: 'No OrderBook found for this trading pair. It will be created automatically when you place the first order.',
        orderBook: null
      });
    }
    
    res.json({
      success: true,
      orderBook: {
        contractId: orderBookContractId,
        operator: orderBookOperator,
        tradingPair: decodedTradingPair
      }
    });
    
  } catch (error) {
    console.error('[OrderBook] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get OrderBook',
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
