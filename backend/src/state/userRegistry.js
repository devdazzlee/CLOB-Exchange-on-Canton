/**
 * User Registry — PostgreSQL-backed via Prisma (Neon)
 * 
 * Stores:
 *   userId -> { partyId, publicKeyBase64, createdAt }
 *   No private key storage is allowed server-side.
 * 
 * ALL reads and writes go DIRECTLY to PostgreSQL.
 * No in-memory cache. Database is the single source of truth.
 */

const { getDb } = require('../services/db');

// ─── User helpers ─────────────────────────────────────────────────────────

function toUserPayload(result) {
  return {
    partyId: result.partyId,
    publicKeyBase64: result.publicKeyBase64,
    displayName: result.displayName,
    createdAt: result.createdAt?.getTime() || Date.now(),
    updatedAt: result.updatedAt?.getTime() || Date.now(),
  };
}

async function upsertUser(userId, updates) {
  if (!userId) throw new Error('userId is required');
  const db = getDb();
  const normalizedPartyId = typeof updates.partyId === 'string' ? updates.partyId.trim() : updates.partyId;

  const createData = {
    id: userId,
    partyId: normalizedPartyId || null,
    publicKeyBase64: updates.publicKeyBase64 || null,
    displayName: updates.displayName || null,
  };

  const updateData = {
    ...(normalizedPartyId !== undefined ? { partyId: normalizedPartyId } : {}),
    ...(updates.publicKeyBase64 !== undefined ? { publicKeyBase64: updates.publicKeyBase64 } : {}),
    ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
  };

  // If this partyId already belongs to a different user row, update that row
  // instead of causing a unique constraint crash.
  if (normalizedPartyId) {
    const existingByParty = await db.user.findUnique({ where: { partyId: normalizedPartyId } });
    if (existingByParty && existingByParty.id !== userId) {
      const merged = await db.user.update({
        where: { id: existingByParty.id },
        data: {
          ...(updates.publicKeyBase64 !== undefined ? { publicKeyBase64: updates.publicKeyBase64 } : {}),
          ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
        },
      });
      return toUserPayload(merged);
    }
  }

  try {
    const result = await db.user.upsert({
      where: { id: userId },
      create: createData,
      update: updateData,
    });
    return toUserPayload(result);
  } catch (err) {
    // Handle races where another request writes the same partyId first.
    if (err?.code === 'P2002' && normalizedPartyId) {
      const existingByParty = await db.user.findUnique({ where: { partyId: normalizedPartyId } });
      if (existingByParty) {
        const merged = await db.user.update({
          where: { id: existingByParty.id },
          data: {
            ...(updates.publicKeyBase64 !== undefined ? { publicKeyBase64: updates.publicKeyBase64 } : {}),
            ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
          },
        });
        return toUserPayload(merged);
      }
    }
    throw err;
  }
}

async function getUser(userId) {
  if (!userId) return null;
  const db = getDb();
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return toUserPayload(u);
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

module.exports = {
  upsertUser,
  getUser,
  requireUser,
  requirePartyId,
  requirePublicKey,
  getAllPartyIds,
};
