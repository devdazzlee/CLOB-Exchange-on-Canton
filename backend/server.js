/**
 * Server Entry Point
 * Professional backend with MVC architecture
 * 
 * Supports both:
 * - Traditional server mode (for local development)
 * - Vercel serverless mode (for deployment)
 */

// Initialize logger FIRST — overrides console.log/warn/error to write to files
const logger = require('./src/utils/logger');

// Enforce secure TLS verification for all outbound HTTPS calls.
// Always normalize this at process start (parent shells may export insecure values).
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') {
  logger.warn(`[Server] Normalizing NODE_TLS_REJECT_UNAUTHORIZED from "${process.env.NODE_TLS_REJECT_UNAUTHORIZED || ''}" -> "1"`);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

const { createApp, startServer } = require('./src/app');

// Check if running on Vercel (serverless)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

if (isVercel) {
  // Vercel serverless mode - export Express app as default
  console.log('[Server] Running in Vercel serverless mode');
  
  const { app } = createApp();

  // ── Eagerly initialize Canton SDK at cold-start ──
  // On local dev, this happens inside startServer(). On Vercel, startServer()
  // is never called, so we must do it here. The middleware in createApp()
  // also awaits this same singleton, ensuring every request waits for SDK readiness.
  (async () => {
    try {
      console.log('[Server/Vercel] 🔄 Initializing Canton Wallet SDK at cold start...');
      const { getCantonSDKClient } = require('./src/services/canton-sdk-client');
      const sdkClient = getCantonSDKClient();
      await sdkClient.initialize();
      if (sdkClient.isReady()) {
        console.log('[Server/Vercel] ✅ Canton Wallet SDK initialized and ready');
      } else {
        console.warn('[Server/Vercel] ⚠️  Canton Wallet SDK initialized but NOT ready');
        console.warn('[Server/Vercel]    initError:', sdkClient.initError);
      }
    } catch (err) {
      console.error('[Server/Vercel] ❌ Canton Wallet SDK init failed:', err.message);
    }
  })();
  
  // Export app as default for Vercel
  module.exports = app;
} else {
  // Traditional server mode - start listening
  console.log('[Server] Running in traditional server mode');
  const { app, server } = startServer();

  // Graceful shutdown helper — stops background services before closing
  function gracefulShutdown(signal) {
    console.log(`${signal} received, shutting down gracefully...`);

    // Stop auto-accept service
    try {
      const { getAutoAcceptService } = require('./src/services/autoAcceptService');
      getAutoAcceptService().stop();
    } catch (_) { /* not critical */ }

    if (server && typeof server.close === 'function') {
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Promise Rejection:', { error: err?.message || err, stack: err?.stack });
    if (server && typeof server.close === 'function') {
      server.close(() => {
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', { error: err?.message || err, stack: err?.stack });
    process.exit(1);
  });

  // Export for compatibility
  module.exports = { app, server };
}
