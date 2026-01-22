/**
 * Backend API Server
 * Entry point for the CLOB Exchange backend
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config';
import routes from './routes';
import { websocketService } from './services/websocket';

const app = express();
const server = http.createServer(app);

// Initialize WebSocket
websocketService.initialize(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Start server
const PORT = config.server.port;

server.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           CLOB Exchange Backend API Server                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${config.server.env}`);
  console.log('');
  console.log('📋 Available Routes:');
  console.log('  GET  /health');
  console.log('  GET  /api/health');
  console.log('  POST /api/onboarding/allocate-party');
  console.log('  POST /api/onboarding/create-preapproval');
  console.log('  POST /api/onboarding/ensure-rights');
  console.log('  POST /api/orders/place');
  console.log('  POST /api/orders/cancel');
  console.log('  GET  /api/balances/:party');
  console.log('  POST /api/faucet/get-funds');
  console.log('  GET  /api/faucet/instruments');
  console.log('  GET  /api/discovery/packages');
  console.log(`  WS   ws://localhost:${PORT} (WebSocket for real-time updates)`);
  console.log('');
});
