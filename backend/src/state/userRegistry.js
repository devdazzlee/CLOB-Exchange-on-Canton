/**
 * In-memory user registry (MVP)
 * Stores mapping: userId -> { partyId, publicKeyBase64, createdAt }
 *
 * Also stores signing keys for external parties in a SEPARATE in-memory map
 * (NOT persisted to disk) for allocation execution at match time.
 * Canton external parties require interactive submission (user signs every tx).
 * Storing the signing key lets the backend sign on behalf of the user
 * for pre-authorized operations (allocation execution during settlement).
 */

const fs = require('fs');
const path = require('path');

const registry = new Map();
const REGISTRY_PATH = path.join(__dirname, '..', '..', '.user-registry.json');

// ─── Signing Keys (in-memory only, NOT persisted to disk) ─────────────
// Maps partyId -> { keyBase64, fingerprint }
// Used by the matching engine to sign Allocation_ExecuteTransfer
// for external parties at match-time.
const signingKeys = new Map();

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

/**
 * Get all registered party IDs (for sharded queries)
 */
function getAllPartyIds() {
  const partyIds = [];
  for (const [, entry] of registry) {
    if (entry.partyId) {
      partyIds.push(entry.partyId);
    }
  }
  return [...new Set(partyIds)]; // deduplicate
}

// ─── Signing Key helpers ──────────────────────────────────────────────

/**
 * Store an external party's Ed25519 signing key (base64) for server-side signing.
 * @param {string} partyId - Canton party ID (e.g. "ext-abc123::1220...")
 * @param {string} keyBase64 - Base64-encoded 32-byte Ed25519 private key
 * @param {string} fingerprint - Public key fingerprint (signedBy in Canton)
 */
function storeSigningKey(partyId, keyBase64, fingerprint) {
  if (!partyId || !keyBase64) return;
  signingKeys.set(partyId, { keyBase64, fingerprint });
  console.log(`[UserRegistry] 🔑 Stored signing key for ${partyId.substring(0, 30)}...`);
}

/**
 * Retrieve an external party's signing key.
 * @param {string} partyId
 * @returns {{ keyBase64: string, fingerprint: string } | null}
 */
function getSigningKey(partyId) {
  return signingKeys.get(partyId) || null;
}

/**
 * Check if a signing key is available for a party.
 */
function hasSigningKey(partyId) {
  return signingKeys.has(partyId);
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



