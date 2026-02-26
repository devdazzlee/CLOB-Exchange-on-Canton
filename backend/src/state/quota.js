/**
 * Quota counters — PostgreSQL via Prisma (Neon)
 * ALL reads/writes go directly to DB. No in-memory cache.
 * Enforces daily + weekly caps for party allocations.
 *
 * Env overrides:
 * - DAILY_PARTY_QUOTA (default 5000)
 * - WEEKLY_PARTY_QUOTA (default 35000)
 */

const { getDb } = require('../services/db');

const DAILY_LIMIT = parseInt(process.env.DAILY_PARTY_QUOTA || '5000', 10);
const WEEKLY_LIMIT = parseInt(process.env.WEEKLY_PARTY_QUOTA || '35000', 10);

function getWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

async function snapshot() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const week = getWeekKey(now);

  const db = getDb();
  const dailyRow = await db.quotaCounter.findUnique({ where: { id: `daily:${today}` } });
  const weeklyRow = await db.quotaCounter.findUnique({ where: { id: `weekly:${week}` } });

  const dailyUsed = dailyRow?.count || 0;
  const weeklyUsed = weeklyRow?.count || 0;

  return {
    dailyUsed,
    dailyLimit: DAILY_LIMIT,
    weeklyUsed,
    weeklyLimit: WEEKLY_LIMIT,
    today,
    week,
  };
}

async function assertAvailable() {
  const s = await snapshot();
  if (s.dailyUsed >= DAILY_LIMIT || s.weeklyUsed >= WEEKLY_LIMIT) {
    const err = new Error('Quota exceeded. Please try again later.');
    err.statusCode = 429;
    err.details = s;
    throw err;
  }
  return s;
}

async function increment() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const week = getWeekKey(now);

  const db = getDb();
  const dailyId = `daily:${today}`;
  const weeklyId = `weekly:${week}`;

  // Upsert daily counter
  await db.quotaCounter.upsert({
    where: { id: dailyId },
    create: { id: dailyId, period: 'daily', periodKey: today, count: 1 },
    update: { count: { increment: 1 } },
  });

  // Upsert weekly counter
  await db.quotaCounter.upsert({
    where: { id: weeklyId },
    create: { id: weeklyId, period: 'weekly', periodKey: week, count: 1 },
    update: { count: { increment: 1 } },
  });

  // Cleanup old entries
  await cleanup();

  return snapshot();
}

async function cleanup() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
  const cutoffWeek = getWeekKey(sevenDaysAgo);

  const db = getDb();
  await db.quotaCounter.deleteMany({
    where: {
      OR: [
        { period: 'daily', periodKey: { lt: cutoffDate } },
        { period: 'weekly', periodKey: { lt: cutoffWeek } },
      ],
    },
  }).catch(() => {});
}

module.exports = {
  assertAvailable,
  increment,
  snapshot,
};
