/**
 * Wallet Authentication Middleware
 * 
 * Verifies app-level session JWTs (NOT Keycloak tokens).
 * Extracts walletId from valid session and attaches to request.
 */

const authService = require('../services/authService');
const { LedgerError } = require('../utils/ledgerError');

/**
 * Middleware to require valid wallet session
 * Sets req.walletId if authenticated
 */
const requireWalletAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'MISSING_AUTH_HEADER',
          message: 'Authorization header required'
        }
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    
    // Verify app session token
    const session = authService.verifySessionToken(token);
    
    if (!session) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'INVALID_SESSION_TOKEN',
          message: 'Invalid or expired session token'
        }
      });
    }

    // Attach wallet info to request
    req.walletId = session.walletId;
    req.sessionId = session.sessionId;

    next();

  } catch (error) {
    console.error('[WalletAuth] Authentication failed:', error);
    return res.status(500).json({
      ok: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      }
    });
  }
};

/**
 * Optional wallet auth - doesn't fail if not authenticated
 * Sets req.walletId if authenticated, otherwise null
 */
const optionalWalletAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.walletId = null;
      req.sessionId = null;
      return next();
    }

    const token = authHeader.substring(7);
    const session = authService.verifySessionToken(token);
    
    if (session) {
      req.walletId = session.walletId;
      req.sessionId = session.sessionId;
    } else {
      req.walletId = null;
      req.sessionId = null;
    }

    next();

  } catch (error) {
    console.error('[OptionalWalletAuth] Authentication failed:', error);
    req.walletId = null;
    req.sessionId = null;
    next();
  }
};

module.exports = {
  requireWalletAuth,
  optionalWalletAuth
};
