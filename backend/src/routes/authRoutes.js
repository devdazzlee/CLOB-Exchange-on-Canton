/**
 * Auth Routes - Session Management
 * 
 * Implements:
 * - POST /auth/session - Create session for wallet
 * - POST /auth/refresh - Refresh access token
 * - POST /auth/logout - Invalidate refresh token
 * - GET /auth/me - Get current user
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

// In-memory refresh token store (use Redis in production)
const refreshTokenStore = new Map();

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_TOKEN_EXPIRY = '15m';  // Short-lived access token
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/**
 * Generate tokens for a user
 */
function generateTokens(user) {
  const accessToken = jwt.sign(
    {
      sub: user.partyId,
      partyId: user.partyId,
      publicKey: user.publicKey,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  const refreshToken = crypto.randomBytes(64).toString('hex');
  const refreshExpiry = Date.now() + REFRESH_TOKEN_EXPIRY;

  refreshTokenStore.set(refreshToken, {
    partyId: user.partyId,
    publicKey: user.publicKey,
    expiresAt: refreshExpiry,
    createdAt: Date.now()
  });

  const decoded = jwt.decode(accessToken);
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

  return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
}

// POST /session - Create session
router.post('/session', async (req, res) => {
  try {
    const { partyId, publicKey } = req.body;
    if (!partyId) {
      return res.status(400).json({ success: false, error: 'partyId is required' });
    }
    console.log('[Auth] Creating session for party:', partyId.substring(0, 20) + '...');
    const tokens = generateTokens({ partyId, publicKey });
    res.json({ success: true, ...tokens, user: { partyId, publicKey } });
  } catch (error) {
    console.error('[Auth] Session creation failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /refresh - Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'refreshToken is required' });
    }
    const tokenData = refreshTokenStore.get(refreshToken);
    if (!tokenData) {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
    if (Date.now() >= tokenData.expiresAt) {
      refreshTokenStore.delete(refreshToken);
      return res.status(401).json({ success: false, error: 'Refresh token expired' });
    }
    console.log('[Auth] Refreshing token for party:', tokenData.partyId.substring(0, 20) + '...');
    refreshTokenStore.delete(refreshToken); // Token rotation
    const tokens = generateTokens({ partyId: tokenData.partyId, publicKey: tokenData.publicKey });
    res.json({ success: true, ...tokens, user: { partyId: tokenData.partyId, publicKey: tokenData.publicKey } });
  } catch (error) {
    console.error('[Auth] Token refresh failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /logout - Invalidate refresh token
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      refreshTokenStore.delete(refreshToken);
      console.log('[Auth] Refresh token invalidated');
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Auth] Logout failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /me - Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ success: true, user: { partyId: decoded.partyId, publicKey: decoded.publicKey } });
    } catch (jwtError) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('[Auth] Get user failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Token verification middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Cleanup expired tokens every hour
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, data] of refreshTokenStore.entries()) {
    if (now >= data.expiresAt) {
      refreshTokenStore.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log('[Auth] Cleaned up', cleaned, 'expired refresh tokens');
}, 60 * 60 * 1000);

module.exports = router;
module.exports.verifyToken = verifyToken;
