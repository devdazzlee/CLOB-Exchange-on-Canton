/**
 * Auth Service - App-Level Sessions
 * 
 * End-users authenticate with cryptographic signatures, NOT Keycloak.
 * Backend issues app-level JWTs for session management.
 * 
 * Flow:
 * 1. POST /v1/auth/challenge - Get nonce to sign
 * 2. POST /v1/auth/unlock - Verify signature, issue app JWT
 */

const config = require('../config');
const walletService = require('./walletService');
const crypto = require('crypto');
const { ValidationError, NotFoundError } = require('../utils/ledgerError');

class AuthService {
  constructor() {
    // In production, use Redis or database for sessions
    this.challenges = new Map(); // nonce -> { walletId, expiresAt }
    this.sessions = new Map();    // sessionId -> { walletId, expiresAt }
    
    // JWT secret for app sessions (NOT Keycloak)
    this.jwtSecret = process.env.APP_JWT_SECRET || crypto.randomBytes(64).toString('hex');
    
    // Cleanup intervals
    setInterval(() => this.cleanupChallenges(), 5 * 60 * 1000); // 5 minutes
    setInterval(() => this.cleanupSessions(), 60 * 60 * 1000); // 1 hour
  }

  /**
   * Generate authentication challenge for wallet
   */
  async generateChallenge(walletId) {
    const requestId = crypto.randomUUID();
    
    if (!walletId) {
      throw new ValidationError('walletId is required');
    }

    // Verify wallet exists
    const partyInfo = await walletService.getPartyInfo(walletId);
    if (!partyInfo) {
      throw new NotFoundError('Wallet', walletId);
    }

    // Generate nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

    // Store challenge
    this.challenges.set(nonce, {
      walletId,
      expiresAt,
      requestId
    });

    console.log(`[AuthService] Generated challenge for ${walletId}: ${nonce.slice(0, 16)}...`);

    return {
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
      walletId
    };
  }

  /**
   * Verify signature and issue app session token
   */
  async unlockWallet({ walletId, nonce, signatureBase64 }) {
    const requestId = crypto.randomUUID();
    
    if (!walletId || !nonce || !signatureBase64) {
      throw new ValidationError('walletId, nonce, and signatureBase64 are required');
    }

    // Verify challenge exists and is not expired
    const challenge = this.challenges.get(nonce);
    if (!challenge) {
      throw new ValidationError('Invalid or expired challenge');
    }
    if (challenge.walletId !== walletId) {
      throw new ValidationError('Challenge walletId mismatch');
    }
    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(nonce);
      throw new ValidationError('Challenge expired');
    }

    try {
      // Get wallet's public key (stored during onboarding)
      const partyInfo = await walletService.getPartyInfo(walletId);
      if (!partyInfo) {
        throw new NotFoundError('Wallet', walletId);
      }

      // Public key is now stored during onboarding
      const publicKeyBase64 = partyInfo.publicKeyBase64Der;
      
      if (!publicKeyBase64) {
        throw new Error('Public key not found for wallet. Wallet may not be fully onboarded.');
      }

      // Verify signature over nonce
      const isValid = walletService.verifySignature(
        nonce,
        signatureBase64,
        publicKeyBase64
      );

      if (!isValid) {
        throw new ValidationError('Invalid signature');
      }

      // Clean up challenge
      this.challenges.delete(nonce);

      // Issue app JWT
      const sessionId = crypto.randomUUID();
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

      this.sessions.set(sessionId, {
        walletId,
        expiresAt,
        requestId
      });

      const appToken = this.generateAppJWT({
        sessionId,
        walletId,
        sub: walletId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(expiresAt / 1000)
      });

      console.log(`[AuthService] ✅ Wallet unlocked: ${walletId}`);

      return {
        sessionToken: appToken,
        walletId,
        expiresAt: new Date(expiresAt).toISOString()
      };

    } catch (error) {
      console.error(`[AuthService] ❌ Wallet unlock failed:`, error.message);
      throw error;
    }
  }

  /**
   * Verify app session token
   */
  verifySessionToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const signature = parts[2];

      // Verify signature (simplified - in production use proper JWT library)
      const expectedSignature = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${parts[0]}.${parts[1]}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      // Check expiry
      if (payload.exp && Date.now() > payload.exp * 1000) {
        return null;
      }

      // Check session exists
      const session = this.sessions.get(payload.sessionId);
      if (!session || Date.now() > session.expiresAt) {
        return null;
      }

      return {
        walletId: payload.walletId,
        sessionId: payload.sessionId
      };

    } catch (error) {
      console.error('[AuthService] Token verification failed:', error);
      return null;
    }
  }

  /**
   * Generate app JWT
   */
  generateAppJWT(payload) {
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Invalidate session
   */
  invalidateSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Cleanup expired challenges
   */
  cleanupChallenges() {
    const now = Date.now();
    for (const [nonce, challenge] of this.challenges.entries()) {
      if (now > challenge.expiresAt) {
        this.challenges.delete(nonce);
      }
    }
  }

  /**
   * Cleanup expired sessions
   */
  cleanupSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

module.exports = new AuthService();
