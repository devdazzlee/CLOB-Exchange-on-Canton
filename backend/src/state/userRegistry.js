/**
 * User Registry — PostgreSQL-backed via Prisma (Neon)
 * 
 * Stores:
 *   userId -> { partyId, publicKeyBase64, createdAt }
 *   partyId -> { keyBase64, fingerprint }  (signing keys)
 * 
 * ALL reads and writes go DIRECTLY to PostgreSQL.
 * No in-memory cache. Database is the single source of truth.
 */

const { getDb } = require('../services/db');

// ─── User helpers ─────────────────────────────────────────────────────────

async function upsertUser(userId, updates) {
  if (!userId) throw new Error('userId is required');
  const db = getDb();
  const result = await db.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      partyId: updates.partyId || null,
      publicKeyBase64: updates.publicKeyBase64 || null,
      displayName: updates.displayName || null,
    },
    update: {
      ...(updates.partyId !== undefined ? { partyId: updates.partyId } : {}),
      ...(updates.publicKeyBase64 !== undefined ? { publicKeyBase64: updates.publicKeyBase64 } : {}),
      ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
    },
  });
  return {
    partyId: result.partyId,
    publicKeyBase64: result.publicKeyBase64,
    displayName: result.displayName,
    createdAt: result.createdAt?.getTime() || Date.now(),
    updatedAt: result.updatedAt?.getTime() || Date.now(),
  };
}

async function getUser(userId) {
  if (!userId) return null;
  const db = getDb();
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return {
    partyId: u.partyId,
    publicKeyBase64: u.publicKeyBase64,
    displayName: u.displayName,
    createdAt: u.createdAt?.getTime() || Date.now(),
    updatedAt: u.updatedAt?.getTime() || Date.now(),
  };
}

async function requireUser(userId) {
  const u = await getUser(userId);
  if (!u) {
    const err = new Error('User not found. Please onboard/create wallet again.');
    err.statusCode = 401;
    throw err;
  }
  return u;
}

async function requirePartyId(userId) {
  const u = await requireUser(userId);
  if (!u.partyId) {
    const err = new Error('No partyId mapped for this user. Please complete onboarding.');
    err.statusCode = 401;
    throw err;
  }
  return u.partyId;
}

async function requirePublicKey(userId) {
  const u = await requireUser(userId);
  if (!u.publicKeyBase64) {
    const err = new Error('No public key registered for this user. Please onboard/create wallet again.');
    err.statusCode = 401;
    throw err;
  }
  return u.publicKeyBase64;
}

async function getAllPartyIds() {
  const db = getDb();
  const users = await db.user.findMany({
    where: { partyId: { not: null } },
    select: { partyId: true },
  });
  return [...new Set(users.map(u => u.partyId).filter(Boolean))];
}

// ─── Signing Key helpers ──────────────────────────────────────────────────

async function storeSigningKey(partyId, keyBase64, fingerprint) {
  if (!partyId || !keyBase64) return;
  const db = getDb();
  await db.signingKey.upsert({
    where: { partyId },
    create: { partyId, keyBase64, fingerprint: fingerprint || null },
    update: { keyBase64, fingerprint: fingerprint || null },
  });
  console.log(`[UserRegistry] 🔑 Stored signing key for ${partyId.substring(0, 30)}... (PostgreSQL)`);
}

async function getSigningKey(partyId) {
  if (!partyId) return null;
  const db = getDb();
  const k = await db.signingKey.findUnique({ where: { partyId } });
  if (!k) return null;
  return { keyBase64: k.keyBase64, fingerprint: k.fingerprint };
}

async function hasSigningKey(partyId) {
  if (!partyId) return false;
  const db = getDb();
  const count = await db.signingKey.count({ where: { partyId } });
  return count > 0;
}

module.exports = {
  upsertUser,
  getUser,
  requireUser,
  requirePartyId,
  requirePublicKey,
  getAllPartyIds,
  storeSigningKey,
  getSigningKey,
  hasSigningKey,
};
