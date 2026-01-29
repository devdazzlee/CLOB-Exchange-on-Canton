/**
 * Party Creation Service - Clean Version
 * Properly registers parties in Canton and generates JWT tokens
 * 
 * IMPORTANT: Uses centralized config - NO HARDCODED FALLBACKS
 */

const crypto = require('crypto');
const config = require('../config');
const CantonAdminService = require('./canton-admin');
const CantonGrpcClient = require('./canton-grpc-client');

// Use centralized config
const DAILY_QUOTA = config.party.dailyQuota;
const WEEKLY_QUOTA = config.party.weeklyQuota;

// In-memory quota tracking
const quotaTracker = {
  daily: new Map(),
  weekly: new Map(),
};

class PartyService {
  constructor() {
    this.adminToken = null;
    this.adminTokenExpiry = null;
  }

  /**
   * Generate a token for the validator-app service account
   */
  async generateTokenForValidatorOperator(partyId) {
    const cantonAdmin = new CantonAdminService();
    return await cantonAdmin.getAdminToken();
  }

  /**
   * Get validator-operator user ID from token
   * Extracts user ID from the token's 'sub' claim
   */
  getValidatorOperatorUserIdFromToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const userId = payload.sub;

      if (!userId) {
        throw new Error('Token missing sub claim');
      }

      return userId;
    } catch (error) {
      throw new Error(`Failed to extract user ID from token: ${error.message}`);
    }
  }

  /**
   * Assign party rights to the validator-operator user via Ledger API gRPC
   */
  async assignPartyToValidatorOperator(partyId) {
    try {
      const cantonAdmin = new CantonAdminService();
      const adminToken = await cantonAdmin.getAdminToken();

      const userId = this.getValidatorOperatorUserIdFromToken(adminToken);

      const grpcClient = new CantonGrpcClient();
      await grpcClient.grantUserRights(userId, partyId, adminToken);
      return { success: true };
    } catch (error) {
      console.error('[PartyService] Failed to grant Canton user rights via gRPC:', error.message);
      throw error;
    }
  }

  checkQuota() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const week = this.getWeekKey(now);

    const dailyCount = quotaTracker.daily.get(today) || 0;
    if (dailyCount >= DAILY_QUOTA) {
      throw new Error(`Daily quota exceeded. Limit: ${DAILY_QUOTA}`);
    }

    const weeklyCount = quotaTracker.weekly.get(week) || 0;
    if (weeklyCount >= WEEKLY_QUOTA) {
      throw new Error(`Weekly quota exceeded. Limit: ${WEEKLY_QUOTA}`);
    }

    return { dailyCount, weeklyCount };
  }

  incrementQuota() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const week = this.getWeekKey(now);

    quotaTracker.daily.set(today, (quotaTracker.daily.get(today) || 0) + 1);
    quotaTracker.weekly.set(week, (quotaTracker.weekly.get(week) || 0) + 1);
    this.cleanupQuotaTracker();
  }

  getWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
  }

  cleanupQuotaTracker() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
    const cutoffWeek = this.getWeekKey(sevenDaysAgo);

    for (const [date] of quotaTracker.daily) {
      if (date < cutoffDate) quotaTracker.daily.delete(date);
    }
    for (const [week] of quotaTracker.weekly) {
      if (week < cutoffWeek) quotaTracker.weekly.delete(week);
    }
  }

  createPartyHintFromPublicKey(publicKeyHex, prefix = 'external-wallet-user') {
    const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
    const digestHex = crypto.createHash('sha256').update(pubKeyBytes).digest('hex');
    return `${prefix}-${digestHex.slice(0, 16)}`;
  }

  /**
   * Create party for user
   */
  async createPartyForUser(publicKeyHex) {
    try {
      // Step 1: Check quota
      const quotaStatus = this.checkQuota();

      // Step 2: Generate party allocation hint
      const partyHint = this.createPartyHintFromPublicKey(publicKeyHex, 'external-wallet-user');

      // Step 3: Register party in Canton
      const cantonAdmin = new CantonAdminService();
      let registrationResult;
      try {
        registrationResult = await cantonAdmin.registerParty(partyHint);

        if (!registrationResult || !registrationResult.success) {
          throw new Error(`Failed to register party: ${registrationResult?.error}`);
        }
      } catch (regError) {
        registrationResult = { success: false, error: regError.message };
      }

      if (!registrationResult?.success) {
        throw new Error(`Party allocation failed: ${registrationResult?.error || 'unknown error'}`);
      }

      // Step 4: Assign party to validator-operator user
      const allocatedPartyId = registrationResult.partyId;
      await this.assignPartyToValidatorOperator(allocatedPartyId);

      // Step 5: Generate JWT token
      const tokenString = await this.generateTokenForValidatorOperator(registrationResult.partyId);

      if (!tokenString || typeof tokenString !== 'string' || tokenString.trim() === '') {
        throw new Error('Token generation failed - invalid token returned');
      }

      // Step 6: Verify party registration
      const verification = await cantonAdmin.verifyPartyRegistration(registrationResult.partyId, tokenString);

      // Step 7: Increment quota
      this.incrementQuota();

      const result = {
        partyId: String(registrationResult.partyId),
        token: String(tokenString),
        quotaStatus: {
          dailyUsed: quotaStatus.dailyCount + 1,
          dailyLimit: DAILY_QUOTA,
          weeklyUsed: quotaStatus.weeklyCount + 1,
          weeklyLimit: WEEKLY_QUOTA,
        },
        registered: registrationResult?.success || false,
        verified: (verification?.verified && verification?.registered) || false,
        registrationMethod: registrationResult?.method || 'unknown',
      };

      if (!result.token || typeof result.token !== 'string' || result.token.trim() === '') {
        throw new Error('Result token validation failed');
      }

      return result;

    } catch (error) {
      console.error('[PartyService] Error creating party:', error);
      throw error;
    }
  }
}

module.exports = PartyService;
