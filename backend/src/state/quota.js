/**
 * In-memory quota counters (MVP)
 * Enforces daily + weekly caps for party allocations.
 *
 * Env overrides:
 * - DAILY_PARTY_QUOTA (default 5000)
 * - WEEKLY_PARTY_QUOTA (default 35000)
 */

const DAILY_LIMIT = parseInt(process.env.DAILY_PARTY_QUOTA || '5000', 10);
const WEEKLY_LIMIT = parseInt(process.env.WEEKLY_PARTY_QUOTA || '35000', 10);

const counters = {
  daily: new Map(), // key: YYYY-MM-DD -> count
  weekly: new Map(), // key: YYYY-Www -> count
};

function getWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

function snapshot() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const week = getWeekKey(now);
  const dailyUsed = counters.daily.get(today) || 0;
  const weeklyUsed = counters.weekly.get(week) || 0;
  return {
    dailyUsed,
    dailyLimit: DAILY_LIMIT,
    weeklyUsed,
    weeklyLimit: WEEKLY_LIMIT,
    today,
    week,
  };
}

function assertAvailable() {
  const s = snapshot();
  if (s.dailyUsed >= DAILY_LIMIT || s.weeklyUsed >= WEEKLY_LIMIT) {
    const err = new Error('Quota exceeded. Please try again later.');
    err.statusCode = 429;
    err.details = s;
    throw err;
  }
  return s;
}

function increment() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const week = getWeekKey(now);
  counters.daily.set(today, (counters.daily.get(today) || 0) + 1);
  counters.weekly.set(week, (counters.weekly.get(week) || 0) + 1);
  cleanup();
  return snapshot();
}

function cleanup() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
  const cutoffWeek = getWeekKey(sevenDaysAgo);
  for (const [date] of counters.daily) {
    if (date < cutoffDate) counters.daily.delete(date);
  }
  for (const [week] of counters.weekly) {
    if (week < cutoffWeek) counters.weekly.delete(week);
  }
}

module.exports = {
  assertAvailable,
  increment,
  snapshot,
};


