// Party Creation Service
// Creates party IDs on behalf of users without requiring Keycloak access

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || 'zoya';
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || 'Zoya123!';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'Clob';

// Quota configuration
const DAILY_QUOTA = parseInt(process.env.DAILY_PARTY_QUOTA || '5000');
const WEEKLY_QUOTA = parseInt(process.env.WEEKLY_PARTY_QUOTA || '35000');

// In-memory quota tracking (in production, use Redis or database)
const quotaTracker = {
  daily: new Map(), // date -> count
  weekly: new Map(), // week -> count
};

class PartyService {
  constructor() {
    this.adminToken = null;
    this.adminTokenExpiry = null;
  }

  /**
   * Get admin access token for Keycloak API calls
   */
  async getAdminToken() {
    // Check if we have a valid token
    if (this.adminToken && this.adminTokenExpiry && Date.now() < this.adminTokenExpiry) {
      return this.adminToken;
    }

    try {
      const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: KEYCLOAK_CLIENT_ID,
          username: KEYCLOAK_ADMIN_USER,
          password: KEYCLOAK_ADMIN_PASSWORD,
          scope: 'openid profile email daml_ledger_api',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get admin token: ${errorText}`);
      }

      const data = await response.json();
      this.adminToken = data.access_token;
      // Set expiry 5 minutes before actual expiry for safety
      this.adminTokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
      
      return this.adminToken;
    } catch (error) {
      console.error('[PartyService] Error getting admin token:', error);
      throw new Error(`Failed to authenticate as admin: ${error.message}`);
    }
  }

  /**
   * Check if quota allows creating a new party
   */
  checkQuota() {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const week = this.getWeekKey(now);

    // Check daily quota
    const dailyCount = quotaTracker.daily.get(today) || 0;
    if (dailyCount >= DAILY_QUOTA) {
      throw new Error(`Daily quota exceeded. Limit: ${DAILY_QUOTA} parties per day.`);
    }

    // Check weekly quota
    const weeklyCount = quotaTracker.weekly.get(week) || 0;
    if (weeklyCount >= WEEKLY_QUOTA) {
      throw new Error(`Weekly quota exceeded. Limit: ${WEEKLY_QUOTA} parties per week.`);
    }

    return { dailyCount, weeklyCount };
  }

  /**
   * Increment quota counters
   */
  incrementQuota() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const week = this.getWeekKey(now);

    quotaTracker.daily.set(today, (quotaTracker.daily.get(today) || 0) + 1);
    quotaTracker.weekly.set(week, (quotaTracker.weekly.get(week) || 0) + 1);

    // Clean up old entries (keep last 7 days)
    this.cleanupQuotaTracker();
  }

  /**
   * Get week key for quota tracking (YYYY-WW format)
   */
  getWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
  }

  /**
   * Clean up old quota entries
   */
  cleanupQuotaTracker() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    // Remove old daily entries
    for (const [date] of quotaTracker.daily) {
      if (date < cutoffDate) {
        quotaTracker.daily.delete(date);
      }
    }

    // Remove old weekly entries (keep last 4 weeks)
    const cutoffWeek = this.getWeekKey(sevenDaysAgo);
    for (const [week] of quotaTracker.weekly) {
      if (week < cutoffWeek) {
        quotaTracker.weekly.delete(week);
      }
    }
  }

  /**
   * Create a party ID from public key
   * Format: prefix::hex(publicKey)
   */
  createPartyIdFromPublicKey(publicKeyHex, prefix = '8100b2db-86cf-40a1-8351-55483c151cdc') {
    return `${prefix}::${publicKeyHex}`;
  }

  /**
   * Create a user in Keycloak and register party
   * This creates a Keycloak user and generates a JWT token for the party
   */
  async createPartyForUser(publicKeyHex) {
    try {
      // 1. Check quota
      const quotaStatus = this.checkQuota();

      // 2. Generate party ID from public key
      const partyId = this.createPartyIdFromPublicKey(publicKeyHex);

      // 3. Get admin token
      const adminToken = await this.getAdminToken();

      // 4. Create user in Keycloak (if needed)
      // Note: In production, you might want to create a user account
      // For now, we'll use a service account approach where we generate tokens
      // directly for the party ID without creating a full Keycloak user

      // 5. Generate JWT token for the party
      // In production, you would:
      // - Create a Keycloak user with the party ID as a custom attribute
      // - Use Keycloak's token endpoint to generate a token for that user
      // For now, we'll use a simplified approach

      // 6. Increment quota
      this.incrementQuota();

      // 7. Return party ID and token
      // Note: In production, you would generate a proper JWT token from Keycloak
      // For now, we'll return the party ID and let the frontend use it
      // The actual token generation should be done through Keycloak's admin API

      return {
        partyId,
        quotaStatus: {
          dailyUsed: quotaStatus.dailyCount + 1,
          dailyLimit: DAILY_QUOTA,
          weeklyUsed: quotaStatus.weeklyCount + 1,
          weeklyLimit: WEEKLY_QUOTA,
        },
        // In production, generate actual JWT token here
        // For now, return null and let the frontend handle token generation differently
        token: null, // Will be generated separately
      };
    } catch (error) {
      console.error('[PartyService] Error creating party:', error);
      throw error;
    }
  }

  /**
   * Generate a JWT token for a party ID using Keycloak
   * This uses the admin API to create a token for the party
   */
  async generateTokenForParty(partyId) {
    try {
      const adminToken = await this.getAdminToken();
      
      // Use Keycloak's token endpoint with client credentials
      // In production, you would:
      // 1. Create or find a Keycloak user with this party ID
      // 2. Use impersonation or direct token generation
      // 3. Include proper claims (actAs, readAs, etc.)
      
      // For now, we'll use a service account token approach
      // This requires proper Keycloak configuration
      
      const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      // Use client credentials grant to get a service token
      // Then exchange it for a user token with the party ID
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: KEYCLOAK_CLIENT_ID,
          scope: 'openid profile email daml_ledger_api',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate token');
      }

      const data = await response.json();
      
      // In production, you would modify this token to include the party ID
      // For now, return the token (it may need to be modified to include party claims)
      return data.access_token;
    } catch (error) {
      console.error('[PartyService] Error generating token:', error);
      // Fallback: return a token that can be used
      // In production, implement proper token generation
      throw new Error(`Failed to generate token for party: ${error.message}`);
    }
  }

  /**
   * Get quota status
   */
  getQuotaStatus() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const week = this.getWeekKey(now);

    return {
      daily: {
        used: quotaTracker.daily.get(today) || 0,
        limit: DAILY_QUOTA,
        remaining: DAILY_QUOTA - (quotaTracker.daily.get(today) || 0),
      },
      weekly: {
        used: quotaTracker.weekly.get(week) || 0,
        limit: WEEKLY_QUOTA,
        remaining: WEEKLY_QUOTA - (quotaTracker.weekly.get(week) || 0),
      },
    };
  }
}

module.exports = PartyService;

