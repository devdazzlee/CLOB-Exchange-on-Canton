// Production Backend Server with Token Exchange and Party Creation
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

    console.log('[API] Creating party for public key:', publicKeyHex.substring(0, 20) + '...');
    
    // Create party for user
    const result = await partyService.createPartyForUser(publicKeyHex);
    
    // Try to generate a token for the party
    try {
      const token = await partyService.generateTokenForParty(result.partyId);
      result.token = token;
    } catch (tokenError) {
      console.warn('[API] Could not generate token, party created but token generation failed:', tokenError.message);
      // Continue without token - frontend can handle this
    }
    
    console.log('[API] Party created successfully:', result.partyId);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Party creation quota: ${process.env.DAILY_PARTY_QUOTA || '5000'} daily, ${process.env.WEEKLY_PARTY_QUOTA || '35000'} weekly`);
});
