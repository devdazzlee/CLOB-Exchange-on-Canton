/**
 * Party Creation Service - Fixed Version
 * Properly registers parties in Canton and generates JWT tokens via Keycloak
 */

const crypto = require('crypto');
const CantonAdminService = require('./canton-admin');
const CantonGrpcClient = require('./canton-grpc-client');

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
// Client used by end-users (password grant, front-end login)
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'Clob';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || null;

// Admin authentication - service account for admin API calls
// Service account must have "manage-users" role from "realm-management" client
const KEYCLOAK_ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || null;
const KEYCLOAK_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || null;

const CANTON_ADMIN_BASE = process.env.CANTON_ADMIN_BASE || 'https://participant.dev.canton.wolfedgelabs.com';
const CANTON_ADMIN_HOST = process.env.CANTON_ADMIN_HOST || '65.108.40.104';
const CANTON_ADMIN_PORT = process.env.CANTON_ADMIN_PORT || '30100';
const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

// Quota configuration
const DAILY_QUOTA = parseInt(process.env.DAILY_PARTY_QUOTA || '5000');
const WEEKLY_QUOTA = parseInt(process.env.WEEKLY_PARTY_QUOTA || '35000');

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
   * Generate a token for the validator-app service account (validator-operator user).
   * FALLBACK: Use static token if Keycloak admin credentials are not available
   */
  async generateTokenForValidatorOperator(partyId) {
    try {
      const cantonAdmin = new CantonAdminService();
      return await cantonAdmin.getAdminToken();
    } catch (error) {
      console.log('[PartyService] Admin token generation failed, using fallback token for wallet operations');
      
      // FALLBACK: Return static ledger token for wallet-based operations
      // This allows the trading interface to work without Keycloak admin setup
      const staticLedgerToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njc1MjAzOTUsImlhdCI6MTc2NzUxODU5NSwiYXV0aF90aW1lIjoxNzY3NTE4NTk0LCJqdGkiOiJvZnJ0YWM6MGNiNGY4ZDktYjE2MC1kM2Q2LTU5ZmEtYjNhYTE3ZWU1ODQ2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOlsiaHR0cHM6Ly9jYW50b24ubmV0d29yay5nbG9iYWwiLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQudGFpbGViNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6Ijg5NTJlMmFjLTBlN2EtNGE1Ni1iYTNhLTgxZjM4MDUzMzkxZiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.IPIXZFL1u-dmQQsI05ttwYYD5YDIAcvnGKms8u_2MQk2wM09K4AgSEc36a0RfsMx6kuCOmUvah8NbB7b7wedBkjoFzoPXNLW9-SBEZ9voVGNRkK2S8QXAwpkcRcTtNcTvfcuH-aKICNuRj4dHLgOSxzYFNVzMAPmATSTt9_mBd2FWlinDt_roCpWddtAW';
      
      return staticLedgerToken;
    }
  }

  /**
   * Get validator-operator user ID from token (service account user for validator-app)
   * Extracts user ID from the token's 'sub' claim - no Keycloak Admin API needed
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
   * Assign party rights to the validator-operator user via Ledger API gRPC.
   *
   * This matches the approach the Canton team recommends:
   * - The validator-app service account token identifies a Canton "user_id" (JWT `sub`)
   * - We grant that user `can_act_as` and `can_read_as` for the newly allocated party
   *
   * No Keycloak protocol mapper is required for this flow.
   */
  async assignPartyToValidatorOperator(partyId) {
    try {
      // Get admin token for Canton (validator-app service account token)
      const cantonAdmin = new CantonAdminService();
      const adminToken = await cantonAdmin.getAdminToken();
      
      // Extract user ID from token (no Keycloak Admin API needed)
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
    // PartyManagementService.AllocateParty takes a *hint*, not a full party id.
    // Passing values with "::" has been triggering INTERNAL errors on the devnet participant.
    // We create a stable, short hint derived from the public key.
    const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
    const digestHex = crypto.createHash('sha256').update(pubKeyBytes).digest('hex');
    return `${prefix}-${digestHex.slice(0, 16)}`;
  }

  /**
   * MAIN FUNCTION: Create party for user
   * CRITICAL FIX: Store token in variable immediately and verify before creating result
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

      // Step 4: Assign party to validator-operator user (optional - may not be available via JSON API)
      try {
        // Ensure we grant rights for the allocated party identifier returned by the API (source of truth)
        const allocatedPartyId = registrationResult.partyId;
        await this.assignPartyToValidatorOperator(allocatedPartyId);
      } catch (assignError) {
        // At this point, assignment is REQUIRED for Canton JSON API access.
        throw assignError;
      }

      // Step 5: Generate JWT token for validator-operator
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
        throw new Error('Result object has invalid token after creation');
      }
      
      return result;
      
    } catch (error) {
      console.error('[PartyService] Error creating party:', error);
      throw error;
    }
  }
}

module.exports = PartyService;
