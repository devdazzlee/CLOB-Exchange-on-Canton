/**
 * Auth Controller
 * 
 * Implements wallet-based authentication:
 * 1. POST /auth/challenge - Get nonce to sign
 * 2. POST /auth/verify - Verify signature, issue session token
 * 
 * NO KEYCLOAK LOGIN FOR END-USERS.
 * Backend manages OAuth tokens on behalf of external party users.
 * 
 * Challenges stored in PostgreSQL via Prisma (no in-memory cache).
 */

const crypto = require('crypto');
const TokenExchangeService = require('../services/token-exchange');
const authService = require('../services/authService');
const walletService = require('../services/walletService');
const userRegistry = require('../state/userRegistry');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const { getDb } = require('../services/db');

class AuthController {
  constructor() {
    this.tokenExchange = new TokenExchangeService();
    
    // Cleanup expired challenges every 5 minutes
    setInterval(() => this.cleanupChallenges(), 5 * 60 * 1000);
  }

  /**
   * Exchange token (legacy - Keycloak flow)
   */
  exchangeToken = asyncHandler(async (req, res) => {
    const { keycloakToken } = req.body;

    if (!keycloakToken) {
      throw new ValidationError('keycloakToken is required');
    }

    const result = await this.tokenExchange.exchangeToken(keycloakToken);
    return success(res, result, 'Token exchanged successfully');
  });

  /**
   * Inspect token
   */
  inspectToken = asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
      throw new ValidationError('token is required');
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new ValidationError('Invalid token format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return success(res, {
        payload,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      }, 'Token inspected successfully');
    } catch (err) {
      throw new ValidationError('Failed to decode token');
    }
  });

  /**
   * POST /api/auth/challenge
   * Generate authentication challenge (nonce) for wallet signature
   */
  generateChallenge = asyncHandler(async (req, res) => {
    const { publicKey, walletId } = req.body;

    if (!publicKey && !walletId) {
      throw new ValidationError('publicKey or walletId is required');
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
    const message = `Sign this message to authenticate with CLOB Exchange: ${nonce}`;

    // Store challenge in PostgreSQL
    const db = getDb();
    await db.authChallenge.create({
      data: {
        nonce,
        walletId: walletId || publicKey || 'unknown',
        expiresAt: new Date(expiresAt),
      },
    });

    console.log(`[AuthController] Generated challenge: ${nonce.slice(0, 16)}... for ${walletId || 'new wallet'}`);

    return success(res, {
      nonce,
      message,
      expiresAt: new Date(expiresAt).toISOString()
    }, 'Challenge generated successfully');
  });

  /**
   * POST /api/auth/verify
   * Verify wallet signature and issue session token
   */
  verifySignature = asyncHandler(async (req, res) => {
    const { publicKey, signature, nonce } = req.body;

    if (!publicKey || !signature || !nonce) {
      throw new ValidationError('publicKey, signature, and nonce are required');
    }

    // Look up challenge from PostgreSQL
    const db = getDb();
    const challenge = await db.authChallenge.findUnique({ where: { nonce } });

    if (!challenge) {
      throw new ValidationError('Invalid or expired challenge');
    }
    if (Date.now() > challenge.expiresAt.getTime()) {
      await db.authChallenge.delete({ where: { nonce } });
      throw new ValidationError('Challenge expired');
    }

    // Reconstruct the message from the nonce
    const message = `Sign this message to authenticate with CLOB Exchange: ${nonce}`;

    // Verify the signature
    try {
      const isValid = this.verifyEd25519Signature(message, signature, publicKey);
      if (!isValid) {
        throw new ValidationError('Invalid signature');
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      console.error('[AuthController] Signature verification failed:', err.message);
      throw new ValidationError('Signature verification failed');
    }

    // Clean up challenge (one-time use)
    await db.authChallenge.delete({ where: { nonce } });

    // Look up or create wallet mapping
    let walletInfo = null;
    try {
      const walletId = this.generateWalletId(publicKey);
      const existingUser = await userRegistry.getUser(walletId);
      if (existingUser && existingUser.partyId) {
        walletInfo = {
          walletId,
          partyId: existingUser.partyId,
          isNew: false
        };
      } else {
        walletInfo = {
          walletId,
          partyId: null,
          isNew: true,
          needsOnboarding: true
        };
        await userRegistry.upsertUser(walletId, { publicKeyBase64: publicKey });
      }
    } catch (err) {
      console.error('[AuthController] Wallet lookup failed:', err.message);
      walletInfo = {
        walletId: this.generateWalletId(publicKey),
        partyId: null,
        isNew: true,
        needsOnboarding: true
      };
      await userRegistry.upsertUser(walletInfo.walletId, { publicKeyBase64: publicKey });
    }

    // Generate session token
    const sessionToken = authService.generateAppJWT({
      walletId: walletInfo.walletId,
      partyId: walletInfo.partyId,
      sub: walletInfo.walletId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)
    });

    console.log(`[AuthController] ✅ Wallet authenticated: ${walletInfo.walletId}`);

    return success(res, {
      sessionToken,
      walletId: walletInfo.walletId,
      partyId: walletInfo.partyId,
      isNew: walletInfo.isNew,
      needsOnboarding: walletInfo.needsOnboarding || false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }, 'Authentication successful');
  });

  /**
   * POST /api/auth/refresh
   * Refresh session token
   */
  refreshToken = asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ValidationError('Bearer token required');
    }

    const token = authHeader.substring(7);
    const session = authService.verifySessionToken(token);

    if (!session) {
      throw new ValidationError('Invalid or expired session token');
    }

    const newToken = authService.generateAppJWT({
      walletId: session.walletId,
      sessionId: session.sessionId,
      sub: session.walletId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)
    });

    return success(res, {
      sessionToken: newToken,
      walletId: session.walletId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }, 'Token refreshed successfully');
  });

  /**
   * Verify Ed25519 signature
   */
  verifyEd25519Signature(message, signatureBase64, publicKeyBase64) {
    try {
      const messageBuffer = Buffer.from(message, 'utf8');
      const signatureBuffer = Buffer.from(signatureBase64, 'base64');
      const publicKeyBuffer = Buffer.from(publicKeyBase64, 'base64');

      try {
        const keyObject = crypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            publicKeyBuffer.length === 32 ? publicKeyBuffer : publicKeyBuffer.slice(-32)
          ]),
          format: 'der',
          type: 'spki'
        });
        return crypto.verify(null, messageBuffer, keyObject, signatureBuffer);
      } catch (rawErr) {
        const keyObject = crypto.createPublicKey({
          key: publicKeyBuffer,
          format: 'der',
          type: 'spki'
        });
        return crypto.verify(null, messageBuffer, keyObject, signatureBuffer);
      }
    } catch (error) {
      console.error('[AuthController] Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Generate wallet ID from public key (deterministic)
   */
  generateWalletId(publicKeyBase64) {
    const hash = crypto.createHash('sha256').update(publicKeyBase64).digest('hex');
    return `wallet-${hash.substring(0, 16)}`;
  }

  /**
   * Cleanup expired challenges from PostgreSQL
   */
  async cleanupChallenges() {
    try {
      const db = getDb();
      const { count } = await db.authChallenge.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        console.log(`[AuthController] Cleaned up ${count} expired challenges`);
      }
    } catch (err) {
      // Non-critical cleanup
    }
  }
}

module.exports = new AuthController();
