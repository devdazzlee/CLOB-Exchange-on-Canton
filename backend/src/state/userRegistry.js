/**
 * In-memory user registry (MVP)
 * Stores mapping: userId -> { partyId, publicKeyBase64, createdAt }
 *
 * IMPORTANT:
 * - This is volatile (resets on server restart).
 * - Do NOT store private keys here (never sent to backend).
 */

const fs = require('fs');
const path = require('path');

const registry = new Map();
const REGISTRY_PATH = path.join(__dirname, '..', '..', '.user-registry.json');

function loadRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return;
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    if (!raw.trim()) return;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([userId, entry]) => {
        registry.set(userId, entry);
      });
    }
  } catch (error) {
    console.warn('[UserRegistry] Failed to load registry:', error.message);
  }
}

function persistRegistry() {
  try {
    const data = Object.fromEntries(registry);
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('[UserRegistry] Failed to persist registry:', error.message);
  }
}

loadRegistry();

function upsertUser(userId, updates) {
  if (!userId) throw new Error('userId is required');
  const existing = registry.get(userId) || { createdAt: Date.now() };
  const next = { ...existing, ...updates, updatedAt: Date.now() };
  registry.set(userId, next);
  persistRegistry();
  return next;
}

function getUser(userId) {
  return registry.get(userId) || null;
}

function requireUser(userId) {
  const u = getUser(userId);
  if (!u) {
    const err = new Error('User not found. Please onboard/create wallet again.');
    err.statusCode = 401;
    throw err;
  }
  return u;
}

function requirePartyId(userId) {
  const u = requireUser(userId);
  if (!u.partyId) {
    const err = new Error('No partyId mapped for this user. Please complete onboarding.');
    err.statusCode = 401;
    throw err;
  }
  return u.partyId;
}

function requirePublicKey(userId) {
  const u = requireUser(userId);
  if (!u.publicKeyBase64) {
    const err = new Error('No public key registered for this user. Please onboard/create wallet again.');
    err.statusCode = 401;
    throw err;
  }
  return u.publicKeyBase64;
}

module.exports = {
  upsertUser,
  getUser,
  requireUser,
  requirePartyId,
  requirePublicKey,
};


