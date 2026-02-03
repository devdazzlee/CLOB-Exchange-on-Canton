/**
 * Express Application Setup
 * Professional backend structure with controllers, services, and routes
 * 
 * IMPORTANT: NO FALLBACKS - Configuration must be complete to start
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { initializeWebSocketService } = require('./services/websocketService');

// Validate configuration on startup - FAIL FAST
console.log('');
console.log('🔧 Validating configuration...');

if (!config.validate()) {
  console.error('');
  console.error('❌ FATAL: Configuration validation failed. Cannot start server.');
  console.error('   Please check your .env file and ensure all required variables are set.');
  console.error('   See .env.example for reference.');
  console.error('');
  process.exit(1);
}

// Log configuration summary (masked)
console.log('');
console.log('📋 Configuration Summary:');
console.log(JSON.stringify(config.getSummary(), null, 2));
console.log('');

/**
 * Create Express application
 */
function createApp() {
  const app = express();
  const server = http.createServer(app);

  // Middleware - CORS configuration
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://clob-exchange-on-canton.vercel.app"
      ];
      
      // Normalize origin (remove trailing slash)
      const normalizedOrigin = origin.replace(/\/$/, '');
      
      // Check exact match
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      
      // Check if it's a Vercel preview deployment
      if (normalizedOrigin.includes('.vercel.app')) {
        return callback(null, true);
      }
      
      // Default: reject
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type", 
      "Authorization", 
      "x-user-id", 
      "x-public-key", 
      "x-party-id", 
      "X-Requested-With",
      "Accept",
      "Origin"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400, // 24 hours
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Security headers (Milestone 4)
  try {
    const { securityHeadersMiddleware, auditLogMiddleware } = require('./middleware/security');
    app.use(securityHeadersMiddleware);
    app.use(auditLogMiddleware);
  } catch (err) {
    console.warn('⚠️  Security middleware not available:', err.message);
  }

  // Activity marker middleware (Milestone 4)
  const { activityMarkerMiddleware } = require('./middleware/activityMarker');
  app.use(activityMarkerMiddleware);

  // Request logging middleware
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });

  // Health check (before API routes)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      config: {
        cantonConfigured: !!config.canton.jsonApiBase,
        operatorConfigured: !!config.canton.operatorPartyId,
        packageConfigured: !!config.canton.packageIds.clobExchange,
      }
    });
  });

  // API Routes
  app.use('/api', routes);

  // v1 Exchange API - Clean, stable API endpoints
  const v1ExchangeRoutes = require('./routes/v1/exchangeRoutes');
  app.use('/api/v1', v1ExchangeRoutes);

  // 404 handler - must be after all routes
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route not found: ${req.method} ${req.path}`
      },
      meta: {
        path: req.path,
        method: req.method
      }
    });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  // Initialize WebSocket service (skip in serverless/Vercel mode)
  const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  if (!isServerless && server) {
    initializeWebSocketService(server);
  } else {
    console.log('[App] Skipping WebSocket initialization (serverless mode)');
  }

  // Milestone 4: Start stop-loss service (skip in serverless mode)
  if (!isServerless) {
    try {
      const { getStopLossService } = require('./services/stopLossService');
      const stopLossService = getStopLossService();
      stopLossService.start().catch(err => {
        console.warn('⚠️  Stop-loss service failed to start:', err.message);
      });
    } catch (err) {
      console.warn('⚠️  Stop-loss service not available:', err.message);
    }
  }

  return { app, server };
}

/**
 * Initialize the Read Model Service for real-time ledger updates
 */
async function initializeReadModel() {
  try {
    const cantonService = require('./services/cantonService');
    const { initializeReadModelService, getReadModelService } = require('./services/readModelService');

    // Initialize the service first (this creates the instance)
    initializeReadModelService(cantonService);
    
    // Now get the initialized instance
    const readModel = getReadModelService();
    if (readModel) {
      await readModel.initialize();
      console.log('✅ Read Model initialized');
    }
    return readModel;
  } catch (error) {
    console.error('⚠️  Read Model initialization failed:', error.message);
    console.error('   The exchange will work but order books may not update in real-time.');
    return null;
  }
}

/**
 * Initialize the Canton Update Stream for persistent order/trade storage
 * This is the proper solution to handle Canton's 200 element query limit
 */
async function initializeUpdateStream() {
  try {
    const { getUpdateStream } = require('./services/cantonUpdateStream');
    const updateStream = getUpdateStream();
    await updateStream.initialize();
    console.log('✅ Canton Update Stream initialized (persistent storage)');
    return updateStream;
  } catch (error) {
    console.error('⚠️  Canton Update Stream initialization failed:', error.message);
    console.error('   The system will try to query Canton directly (may hit 200+ limit).');
    return null;
  }
}

/**
 * Start server
 */
async function startServer() {
  const { app, server } = createApp();
  const PORT = config.server.port;

  // Listen on all interfaces
  server.listen(PORT, '0.0.0.0', async () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           CLOB Exchange Backend Server                         ║');
    console.log('║           Canton/DAML Powered - No Fallbacks                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ WebSocket available at ws://localhost:${PORT}${config.websocket.path}`);
    console.log(`✅ Environment: ${config.server.env}`);
    console.log('');

    // Initialize Read Model (non-blocking)
    console.log('🔄 Initializing Read Model from Canton ledger...');
    await initializeReadModel();

    // Initialize Update Stream for persistent storage
    console.log('🔄 Initializing Canton Update Stream (persistent storage)...');
    await initializeUpdateStream();

    // Start matching engine if enabled
    if (config.matchingEngine.enabled) {
      console.log('');
      console.log('🤖 Starting Matching Engine...');
      const { getMatchingEngine } = require('./services/matching-engine');
      const matchingEngine = getMatchingEngine();

      try {
        await matchingEngine.start();
        console.log(`✅ Matching Engine started (interval: ${matchingEngine.pollingInterval}ms)`);
      } catch (error) {
        console.error('⚠️  Failed to start Matching Engine:', error.message);
      }
    } else {
      console.log('');
      console.log('⚠️  Matching Engine disabled (set ENABLE_MATCHING_ENGINE=true to enable)');
    }

    // Milestone 4: Start stop-loss service
    console.log('');
    console.log('🛡️  Starting Stop-Loss Service...');
    try {
      const { getStopLossService } = require('./services/stopLossService');
      const stopLossService = getStopLossService();
      await stopLossService.start();
      console.log('✅ Stop-Loss Service started');
    } catch (error) {
      console.warn('⚠️  Stop-loss service not available:', error.message);
    }

    console.log('');
    console.log('📋 Exchange API Endpoints:');
    console.log('  POST /api/v1/orders        - Place order');
    console.log('  DELETE /api/v1/orders/:id  - Cancel order');
    console.log('  GET /api/v1/orderbooks/:p  - Get order book');
    console.log('  GET /api/v1/orders         - Get user orders');
    console.log('  GET /api/v1/trades         - Get recent trades');
    console.log('  GET /api/v1/balances       - Get user balances');
    console.log('');
    console.log('🚀 Server is ready to accept connections');
    console.log('');
  });

  // Error handler for listen
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use!`);
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });

  return { app, server };
}

module.exports = { createApp, startServer };
