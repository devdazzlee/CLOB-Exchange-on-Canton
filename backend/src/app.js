/**
 * Express Application Setup
 * Professional backend structure with controllers, services, and routes
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { initializeWebSocketService } = require('./services/websocketService');

/**
 * Create Express application
 */
function createApp() {
  const app = express();
  const server = http.createServer(app);

  // Middleware
  app.use(cors({
    origin: "http://localhost:3000",
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log(`[Request] Full URL: ${req.url}`);
    console.log(`[Request] Base URL: ${req.baseUrl}`);
    console.log(`[Request] Original URL: ${req.originalUrl}`);
    next();
  });

  // Health check (before API routes)
  app.get('/health', (req, res) => {
    console.log('[Health] Health check endpoint called!');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API Routes
  app.use('/api', (req, res, next) => {
    console.log(`[App] API route hit: ${req.method} ${req.path}`);
    console.log(`[App] Original URL: ${req.originalUrl}`);
    next();
  }, routes);
  
  // Debug: Test route registration
  app.get('/api/test-routes', (req, res) => {
    res.json({
      message: 'API routes are working',
      timestamp: new Date().toISOString(),
      routes: {
        'POST /api/create-party': 'Should be available',
        'GET /api/quota-status': 'Should be available',
      }
    });
  });

  // 404 handler - must be after all routes
  app.use((req, res) => {
    console.log(`[404 Handler] Route not found: ${req.method} ${req.path}`);
    console.log(`[404 Handler] Original URL: ${req.originalUrl}`);
    res.status(404).json({
      success: false,
      error: 'Route not found',
      path: req.path,
      method: req.method,
      originalUrl: req.originalUrl,
    });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  // Initialize WebSocket service
  initializeWebSocketService(server);

  return { app, server };
}

/**
 * Start server
 */
function startServer() {
  const { app, server } = createApp();

  const PORT = config.server.port;

  // Listen on all interfaces (0.0.0.0) to ensure server is accessible
  server.listen(PORT, '0.0.0.0', async () => {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           CLOB Exchange Backend Server                         ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✓ Server running on port ${PORT} (0.0.0.0:${PORT})`);
    console.log(`✓ Server address: ${server.address()?.address}:${server.address()?.port}`);
    console.log(`✓ WebSocket server available at ws://localhost:${PORT}${config.websocket.path}`);
    console.log(`✓ Environment: ${config.server.env}`);
    console.log(`✓ Party creation quota: ${config.party.dailyQuota} daily, ${config.party.weeklyQuota} weekly`);
    console.log('');
    console.log('📋 Available Routes:');
    console.log('  GET  /health');
    console.log('  GET  /api/health');
    console.log('  GET  /api/orderbooks');
    console.log('  GET  /api/orderbooks/:tradingPair');
    console.log('  POST /api/orders/place');
    console.log('  POST /api/orders/cancel');
    console.log('  POST /api/admin/orderbooks/:tradingPair');
    console.log('  POST /api/create-party');
    console.log('  POST /api/onboarding/allocate-party');
    console.log('  GET  /api/quota-status');
    console.log('  POST /api/token-exchange');
    console.log('  ALL  /api/ledger/* (proxy)');
    console.log('');
    console.log('🔍 Debug: Server is ready to accept connections');

    // Start matching engine if enabled
    if (process.env.ENABLE_MATCHING_ENGINE === 'true') {
      console.log('');
      console.log('🤖 Starting Matching Engine...');
      const { getMatchingEngine } = require('./services/matching-engine');
      const matchingEngine = getMatchingEngine();

      try {
        await matchingEngine.start();
        console.log('✓ Matching Engine started successfully');
        console.log(`  Polling interval: ${matchingEngine.pollingInterval}ms`);
      } catch (error) {
        console.error('✗ Failed to start Matching Engine:', error.message);
      }
    } else {
      console.log('');
      console.log('⚠️  Matching Engine disabled (set ENABLE_MATCHING_ENGINE=true to enable)');
    }
    console.log('');
  });

  // Add error handler for listen
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use!`);
      console.error('   Please stop the other server or use a different port.');
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });

  return { app, server };
}

module.exports = { createApp, startServer };
