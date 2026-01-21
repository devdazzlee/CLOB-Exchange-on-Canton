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
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Health check (before API routes)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API Routes
  app.use('/api', routes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
      path: req.path,
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

  server.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           CLOB Exchange Backend Server                         ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✓ Server running on port ${PORT}`);
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
    console.log('  POST /api/party/create');
    console.log('  GET  /api/party/quota-status');
    console.log('  POST /api/token-exchange');
    console.log('  ALL  /api/ledger/* (proxy)');
    console.log('');
  });

  return { app, server };
}

module.exports = { createApp, startServer };
