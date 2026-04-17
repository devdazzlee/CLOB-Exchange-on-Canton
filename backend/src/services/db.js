/**
 * Database Service — Prisma Client Singleton
 * 
 * Single Prisma client instance shared across the application.
 * Connects to Neon PostgreSQL for persistent storage of:
 * - Users & public keys (private keys NEVER stored server-side)
 * - Wallet info
 * - Order reservations
 * - Stop-loss orders
 * - Auth sessions, challenges, refresh tokens
 * - Quota counterss
 */

const { PrismaClient } = require('@prisma/client');

let prisma;

function getDb() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    
    // Suppress transient network errors — these are handled by each caller's try/catch.
    // Logging them here produces duplicate spam since the global handler fires before
    // the caller's catch block can suppress them.
    prisma.$on('error', (e) => {
      const msg = e.message || '';
      const isTransientNetwork =
        msg.includes('10054') ||
        msg.includes('Connection reset') ||
        msg.includes("Can't reach database server") ||
        msg.includes('connect ECONNREFUSED') ||
        msg.includes('connection refused') ||
        msg.includes('ECONNRESET') ||
        msg.includes('socket hang up');
      if (!isTransientNetwork) {
        console.error(`[Prisma Error] ${e.target}: ${msg}`);
      }
    });

    console.log('[DB] 🗄️  Prisma client initialized (Neon PostgreSQL)');
  }
  return prisma;
}

/**
 * Graceful shutdown — close DB connections
 */
async function disconnectDb() {
  if (prisma) {
    await prisma.$disconnect();
    console.log('[DB] Disconnected from PostgreSQL');
  }
}

// Handle process exit
process.on('beforeExit', async () => {
  await disconnectDb();
});

module.exports = { getDb, disconnectDb };
