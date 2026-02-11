/**
 * Server Entry Point
 * Professional backend with MVC architecture
 * 
 * Supports both:
 * - Traditional server mode (for local development)
 * - Vercel serverless mode (for deployment)
 */

const { createApp, startServer } = require('./src/app');

// Check if running on Vercel (serverless)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

if (isVercel) {
  // Vercel serverless mode - export Express app as default
  console.log('[Server] Running in Vercel serverless mode');
  
  // Ensure TLS bypass for DevNet Keycloak (self-signed cert)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  
  const { app } = createApp();
  
  // Export app as default for Vercel
  module.exports = app;
} else {
  // Traditional server mode - start listening
  console.log('[Server] Running in traditional server mode');
  const { app, server } = startServer();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (server && typeof server.close === 'function') {
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    if (server && typeof server.close === 'function') {
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
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
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });

  // Export for compatibility
  module.exports = { app, server };
}
