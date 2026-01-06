// Production Backend Server with Token Exchange and Party Creation
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TokenExchangeService = require('./token-exchange');
const PartyService = require('./party-service');

const app = express();
const tokenExchange = new TokenExchangeService();
const partyService = new PartyService();

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

// Ledger API proxy endpoints
app.all('/api/ledger/*', async (req, res) => {
  await tokenExchange.proxyLedgerApiCall(req, res);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test Service Account configuration - detailed inspection
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
        message: 'Service Account is properly configured and has permissions',
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
        fix: testResponse.status === 403 
          ? 'Assign "manage-users" role from "realm-management" client to the service account'
          : `Unexpected error: ${testResponse.status}`
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Party creation quota: ${process.env.DAILY_PARTY_QUOTA || '5000'} daily, ${process.env.WEEKLY_PARTY_QUOTA || '35000'} weekly`);
});
