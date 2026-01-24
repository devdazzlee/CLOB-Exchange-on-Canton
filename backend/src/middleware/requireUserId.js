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

  if ((partyId && partyId.trim()) || (publicKeyBase64 && publicKeyBase64.trim())) {
    userRegistry.upsertUser(trimmedUserId, {
      ...(partyId && partyId.trim() ? { partyId: partyId.trim() } : {}),
      ...(publicKeyBase64 && publicKeyBase64.trim() ? { publicKeyBase64: publicKeyBase64.trim() } : {}),
    });
  }

  req.userId = trimmedUserId;
  next();
};


