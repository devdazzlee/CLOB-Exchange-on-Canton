/**
 * MVP identity middleware.
 * Requires x-user-id header and attaches req.userId.
 */

const userRegistry = require('../state/userRegistry');

module.exports = function requireUserId(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({
      error: 'Missing x-user-id header',
      details: 'For MVP, frontend must send x-user-id on every /api/ledger and /api/onboarding request.',
    });
  }
  const trimmedUserId = userId.trim();
  const partyId = req.header('x-party-id');
  const publicKeyBase64 = req.header('x-public-key');

  const hasParty = !!(partyId && partyId.trim());
  const hasPublicKey = !!(publicKeyBase64 && publicKeyBase64.trim());
  const hasMappableIdentity = trimmedUserId !== 'unknown' && trimmedUserId !== 'null';

  if ((hasParty || hasPublicKey) && hasMappableIdentity) {
    void userRegistry.upsertUser(trimmedUserId, {
      ...(hasParty ? { partyId: partyId.trim() } : {}),
      ...(hasPublicKey ? { publicKeyBase64: publicKeyBase64.trim() } : {}),
    }).catch((err) => {
      // Never crash request flow for registry-sync side effects.
      console.warn('[requireUserId] Failed to sync user registry:', err.message);
    });
  }

  req.userId = trimmedUserId;
  next();
};



