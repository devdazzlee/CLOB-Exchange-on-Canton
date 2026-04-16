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
    
    // Filter out noisy transient network errors (like os error 10054)
    prisma.$on('error', (e) => {
      if (!e.message.includes('10054') && !e.message.includes('Connection reset')) {
        console.error(`[Prisma Error] ${e.target}: ${e.message}`);
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
