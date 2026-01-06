/**
 * Party Creation Service - Fixed Version
 * Properly registers parties in Canton and generates JWT tokens via Keycloak
 */

const crypto = require('crypto');
const CantonAdminService = require('./canton-admin');

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || 'zoya';
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || 'Zoya123!';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'Clob';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || null;
const KEYCLOAK_ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'admin-cli';

const CANTON_ADMIN_BASE = process.env.CANTON_ADMIN_BASE || 'https://participant.dev.canton.wolfedgelabs.com';

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

  async getKeycloakAdminToken() {
    if (this.adminToken && this.adminTokenExpiry && Date.now() < this.adminTokenExpiry) {
      return this.adminToken;
    }

    try {
      console.log('[PartyService] Getting admin token using client credentials (service account)');
      
      const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      // Use client_credentials grant for service account
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: KEYCLOAK_CLIENT_ID,
      });
      
      // Service account requires client secret for confidential clients
      if (KEYCLOAK_CLIENT_SECRET && KEYCLOAK_CLIENT_SECRET.trim() !== '') {
        params.append('client_secret', KEYCLOAK_CLIENT_SECRET);
        console.log('[PartyService] Using client secret for service account');
      } else {
        console.warn('[PartyService] No client secret provided - client must be public or service accounts may not work');
      }
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PartyService] Service account token request failed:', errorText);
        
        if (response.status === 401 || response.status === 403) {
          console.error('[PartyService] ===== SERVICE ACCOUNT NOT CONFIGURED =====');
          console.error('[PartyService] The "Clob" client needs Service Accounts enabled.');
          console.error('[PartyService] Required Keycloak configuration:');
          console.error('[PartyService] 1. Go to Clients → "Clob" → Settings');
          console.error('[PartyService] 2. Enable "Service Accounts Enabled"');
          console.error('[PartyService] 3. Go to "Service Account Roles" tab');
          console.error('[PartyService] 4. Assign "manage-users" role from "realm-management" client');
          console.error('[PartyService] See KEYCLOAK_SERVICE_ACCOUNT_SETUP.md for details');
          console.error('[PartyService] ===========================================');
        }
        
        throw new Error(`Failed to get service account token (${response.status}): ${errorText}. If 401/403, ensure Service Accounts are enabled for "Clob" client.`);
      }

      const data = await response.json();
      
      if (!data || !data.access_token) {
        throw new Error('Service account token response missing access_token');
      }
      
      this.adminToken = data.access_token;
      this.adminTokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
      console.log('[PartyService] Service account admin token obtained successfully');
      return this.adminToken;
      
    } catch (error) {
      console.error('[PartyService] Error getting service account token:', error);
      throw new Error(`Failed to authenticate service account: ${error.message}`);
    }
  }

  async createKeycloakUser(partyId, publicKeyHex) {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      
      const username = `party_${publicKeyHex.substring(0, 16)}`;
      const password = crypto.randomBytes(16).toString('hex');
      
      const usersUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users`;
      console.log('[PartyService] Checking if user exists:', username);
      
      const checkResponse = await fetch(`${usersUrl}?username=${encodeURIComponent(username)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (checkResponse.ok) {
        const existingUsers = await checkResponse.json();
        if (existingUsers && existingUsers.length > 0) {
          console.log('[PartyService] User already exists:', username);
          const existingUserId = existingUsers[0].id;
          
          const newPassword = crypto.randomBytes(16).toString('hex');
          const resetPasswordUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${existingUserId}/reset-password`;
          
          const resetResponse = await fetch(resetPasswordUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'password',
              value: newPassword,
              temporary: false,
            }),
          });

          if (!resetResponse.ok) {
            const errorText = await resetResponse.text();
            throw new Error(`Failed to reset password: ${errorText}`);
          }

          // Clear required actions for existing user
          console.log('[PartyService] Clearing required actions for existing user');
          const updateUserUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${existingUserId}`;
          await fetch(updateUserUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              enabled: true,
              emailVerified: true,
              requiredActions: [],
            }),
          });

          console.log('[PartyService] Password reset for existing user');
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            userId: existingUserId,
            username: username,
            password: newPassword,
          };
        }
      }

      console.log('[PartyService] Creating new user:', username);
      const createUserResponse = await fetch(usersUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username,
          email: `${username}@canton.local`,
          enabled: true,
          emailVerified: true,
          attributes: {
            cantonPartyId: [partyId],
            publicKeyHex: [publicKeyHex],
          },
          credentials: [{
            type: 'password',
            value: password,
            temporary: false,
          }],
        }),
      });

      if (!createUserResponse.ok) {
        const errorText = await createUserResponse.text();
        const status = createUserResponse.status;
        
        // Provide helpful error message for 403 (permission denied)
        if (status === 403) {
          console.error('[PartyService] ===== PERMISSION DENIED =====');
          console.error('[PartyService] The service account does not have permission to create users.');
          console.error('[PartyService] Required Keycloak configuration:');
          console.error('[PartyService] 1. Enable "Service Accounts Enabled" for "Clob" client');
          console.error('[PartyService] 2. Assign "manage-users" role from "realm-management" client to service account');
          console.error('[PartyService] See KEYCLOAK_SERVICE_ACCOUNT_SETUP.md for details');
          console.error('[PartyService] ====================================');
          throw new Error('Service account lacks permission to create users. Please enable Service Accounts and assign manage-users role in Keycloak. See KEYCLOAK_SERVICE_ACCOUNT_SETUP.md');
        }
        
        if (status === 409) {
          console.log('[PartyService] 409 conflict, user might exist');
          const searchResponse = await fetch(`${usersUrl}?username=${encodeURIComponent(username)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (searchResponse.ok) {
            const users = await searchResponse.json();
            if (users && users.length > 0) {
              const existingUserId = users[0].id;
              const newPassword = crypto.randomBytes(16).toString('hex');
              const resetPasswordUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${existingUserId}/reset-password`;
              
              const resetResponse = await fetch(resetPasswordUrl, {
                method: 'PUT',
                headers: {
                  'Authorization': `Bearer ${adminToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  type: 'password',
                  value: newPassword,
                  temporary: false,
                }),
              });
              
              if (resetResponse.ok) {
                // Clear required actions
                const updateUserUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${existingUserId}`;
                await fetch(updateUserUrl, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    enabled: true,
                    emailVerified: true,
                    requiredActions: [],
                  }),
                });
                
                console.log('[PartyService] Retrieved existing user and reset password');
                await new Promise(resolve => setTimeout(resolve, 500));
                return {
                  userId: existingUserId,
                  username: username,
                  password: newPassword,
                };
              }
            }
          }
        }
        
        throw new Error(`Failed to create user (${status}): ${errorText}`);
      }

      let userId = null;
      const location = createUserResponse.headers.get('Location');
      if (location) {
        userId = location.split('/').pop();
      } else {
        const searchResponse = await fetch(`${usersUrl}?username=${encodeURIComponent(username)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (searchResponse.ok) {
          const users = await searchResponse.json();
          if (users && users.length > 0) {
            userId = users[0].id;
          }
        }
      }

      if (!userId) {
        throw new Error('User created but could not retrieve user ID');
      }

      // CRITICAL: Clear required actions to allow password grant
      console.log('[PartyService] Clearing required actions for user:', userId);
      const updateUserUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`;
      const updateResponse = await fetch(updateUserUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          emailVerified: true,
          requiredActions: [], // Clear all required actions
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.warn('[PartyService] Failed to clear required actions:', errorText);
        // Continue anyway - might still work
      } else {
        console.log('[PartyService] Required actions cleared successfully');
      }

      console.log('[PartyService] User created successfully:', username);
      // Wait for Keycloak to fully process user creation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { userId, username, password };
    } catch (error) {
      console.error('[PartyService] Error creating Keycloak user:', error);
      throw error;
    }
  }

  async generateTokenForParty(partyId, userInfo, retryCount = 0) {
    try {
      if (!userInfo || !userInfo.username || !userInfo.password) {
        throw new Error('User credentials required for token generation');
      }

      const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      // Build request parameters
      const params = new URLSearchParams({
        grant_type: 'password',
        client_id: KEYCLOAK_CLIENT_ID,
        username: userInfo.username,
        password: userInfo.password,
        scope: 'openid profile email daml_ledger_api',
      });
      
      // Only add client_secret if provided (for confidential clients)
      // Public clients don't use client_secret
      if (KEYCLOAK_CLIENT_SECRET && KEYCLOAK_CLIENT_SECRET.trim() !== '') {
        params.append('client_secret', KEYCLOAK_CLIENT_SECRET);
        console.log('[PartyService] Using client secret (confidential client)');
      } else {
        console.log('[PartyService] No client secret (public client)');
      }
      
      console.log('[PartyService] Requesting token for user:', userInfo.username, retryCount > 0 ? `(retry ${retryCount})` : '');
      console.log('[PartyService] Token URL:', tokenUrl);
      console.log('[PartyService] Client ID:', KEYCLOAK_CLIENT_ID);
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const responseText = await response.text();
      console.log('[PartyService] ===== KEYCLOAK TOKEN RESPONSE =====');
      console.log('[PartyService] Response status:', response.status);
      console.log('[PartyService] Response status text:', response.statusText);
      console.log('[PartyService] Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
      console.log('[PartyService] Response body length:', responseText.length);
      console.log('[PartyService] Response body (first 500 chars):', responseText.substring(0, 500));
      console.log('[PartyService] ====================================');

      if (!response.ok) {
        console.error('[PartyService] Token request failed with status:', response.status);
        console.error('[PartyService] Full error response:', responseText);
        
        let errorMessage = responseText;
        let errorData = null;
        try {
          errorData = JSON.parse(responseText);
          errorMessage = errorData.error_description || errorData.error || responseText;
          console.error('[PartyService] Parsed error:', JSON.stringify(errorData, null, 2));
        } catch (e) {
          console.error('[PartyService] Could not parse error response as JSON');
        }
        
        // Retry once if user might not be ready yet (common after user creation)
        if (retryCount === 0 && (response.status === 401 || response.status === 403)) {
          const errorLower = errorMessage.toLowerCase();
          if (errorLower.includes('required action') || errorLower.includes('account') || errorLower.includes('invalid')) {
            console.log('[PartyService] Retrying token request after delay (user might not be ready)');
            await new Promise(resolve => setTimeout(resolve, 2000));
            return this.generateTokenForParty(partyId, userInfo, 1);
          }
        }
        
        throw new Error(`Token generation failed (${response.status}): ${errorMessage}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
        console.log('[PartyService] Parsed response keys:', Object.keys(data));
        console.log('[PartyService] access_token exists:', 'access_token' in data);
        console.log('[PartyService] access_token type:', typeof data.access_token);
        console.log('[PartyService] access_token is null:', data.access_token === null);
        console.log('[PartyService] access_token is undefined:', data.access_token === undefined);
      } catch (parseError) {
        console.error('[PartyService] Failed to parse token response as JSON');
        console.error('[PartyService] Parse error:', parseError.message);
        console.error('[PartyService] Response text:', responseText);
        throw new Error(`Invalid JSON response from Keycloak: ${parseError.message}`);
      }
      
      // CRITICAL: Explicit null/undefined check
      if (!data) {
        console.error('[PartyService] Response data is null/undefined');
        throw new Error('Keycloak returned null/undefined response');
      }
      
      if (data.access_token === null || data.access_token === undefined) {
        console.error('[PartyService] Response contains null/undefined access_token');
        console.error('[PartyService] Full response:', JSON.stringify(data, null, 2));
        console.error('[PartyService] Response keys:', Object.keys(data));
        throw new Error('Token response contains null/undefined access_token - Keycloak password grant may have failed');
      }
      
      if (typeof data.access_token !== 'string') {
        console.error('[PartyService] Invalid access_token type:', typeof data.access_token);
        console.error('[PartyService] access_token value:', data.access_token);
        throw new Error(`Invalid access_token type: expected string, got ${typeof data.access_token}`);
      }
      
      if (data.access_token.trim() === '') {
        console.error('[PartyService] access_token is empty string');
        throw new Error('access_token is empty string');
      }
      
      console.log('[PartyService] Token generated successfully, length:', data.access_token.length);
      
      // ============================================
      // CRITICAL FIX: Return as string explicitly
      // Store in variable to ensure it's not lost
      // ============================================
      const tokenString = String(data.access_token);
      
      // Verify it's really a string before returning
      if (typeof tokenString !== 'string') {
        throw new Error(`Token conversion failed - type is ${typeof tokenString}`);
      }
      
      console.log('[PartyService] Returning token string, length:', tokenString.length);
      return tokenString;
      
    } catch (error) {
      console.error('[PartyService] Error generating token:', error);
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

  createPartyIdFromPublicKey(publicKeyHex, prefix = '8100b2db-86cf-40a1-8351-55483c151cdc') {
    return `${prefix}::${publicKeyHex}`;
  }

  /**
   * MAIN FUNCTION: Create party for user
   * CRITICAL FIX: Store token in variable immediately and verify before creating result
   */
  async createPartyForUser(publicKeyHex) {
    try {
      console.log('[PartyService] ===== START CREATE PARTY =====');
      
      // Step 1: Check quota
      const quotaStatus = this.checkQuota();

      // Step 2: Generate party ID
      const partyId = this.createPartyIdFromPublicKey(publicKeyHex);
      console.log('[PartyService] Creating party:', partyId);

      // Step 3: Register party in Canton
      console.log('[PartyService] Registering party in Canton...');
      const cantonAdmin = new CantonAdminService();
      let registrationResult;
      try {
        registrationResult = await cantonAdmin.registerParty(partyId);

        if (!registrationResult || !registrationResult.success) {
          const existsCheck = await cantonAdmin.checkPartyExists(partyId);
          if (existsCheck.exists) {
            console.log('[PartyService] Party already exists in Canton');
            registrationResult = { success: true, method: 'already-exists' };
          } else {
            throw new Error(`Failed to register party: ${registrationResult?.error}`);
          }
        } else {
          console.log('[PartyService] Party registered via', registrationResult.method);
        }
      } catch (regError) {
        console.error('[PartyService] Registration error:', regError);
        registrationResult = { success: false, error: regError.message };
        console.warn('[PartyService] Continuing despite registration error');
      }

      // Step 4: Create Keycloak user
      console.log('[PartyService] Creating Keycloak user...');
      let userInfo;
      try {
        userInfo = await this.createKeycloakUser(partyId, publicKeyHex);
        console.log('[PartyService] Keycloak user created:', userInfo.username);
      } catch (userError) {
        console.error('[PartyService] User creation failed:', userError);
        
        // Check if it's a permission error
        if (userError.message.includes('403') || userError.message.includes('Forbidden')) {
          const errorMsg = `Keycloak Service Account not configured. Required: Enable "Service Accounts Enabled" for "Clob" client and assign "manage-users" role. See KEYCLOAK_SERVICE_ACCOUNT_SETUP.md`;
          console.error('[PartyService] ===== CONFIGURATION REQUIRED =====');
          console.error('[PartyService]', errorMsg);
          console.error('[PartyService] ===================================');
          throw new Error(errorMsg);
        }
        
        throw new Error(`Failed to create Keycloak user: ${userError.message}`);
      }

      // Step 5: Generate JWT token
      console.log('[PartyService] Generating JWT token...');
      
      // ============================================
      // CRITICAL: Store token immediately in variable
      // ============================================
      let tokenString = null;
      
      try {
        if (!userInfo || !userInfo.username || !userInfo.password) {
          console.error('[PartyService] CRITICAL: User credentials incomplete');
          console.error('[PartyService] userInfo:', userInfo ? 'exists' : 'null');
          console.error('[PartyService] username:', userInfo?.username);
          console.error('[PartyService] password:', userInfo?.password ? 'exists' : 'missing');
          throw new Error('User credentials incomplete');
        }

        console.log('[PartyService] Calling generateTokenForParty...');
        console.log('[PartyService] User info:', { username: userInfo.username, hasPassword: !!userInfo.password });
        
        const tokenResult = await this.generateTokenForParty(partyId, userInfo);
        
        console.log('[PartyService] Token received from generateTokenForParty');
        console.log('[PartyService] Token type:', typeof tokenResult);
        console.log('[PartyService] Token length:', tokenResult?.length);
        console.log('[PartyService] Token is string:', typeof tokenResult === 'string');
        console.log('[PartyService] Token is truthy:', !!tokenResult);
        console.log('[PartyService] Token value (first 50 chars):', tokenResult ? tokenResult.substring(0, 50) : 'null/undefined');
        
        // CRITICAL: Check if tokenResult is null/undefined BEFORE assignment
        if (tokenResult === null || tokenResult === undefined) {
          console.error('[PartyService] CRITICAL: generateTokenForParty returned null/undefined');
          console.error('[PartyService] This should never happen - generateTokenForParty should throw an error instead');
          throw new Error('Token generation returned null/undefined - this indicates a critical bug');
        }
        
        // Store immediately
        tokenString = tokenResult;
        
        // Verify immediately after storing
        if (!tokenString) {
          console.error('[PartyService] CRITICAL: tokenString is falsy after assignment');
          console.error('[PartyService] tokenResult was:', tokenResult);
          console.error('[PartyService] tokenResult type:', typeof tokenResult);
          throw new Error('Token is null/undefined after generation');
        }
        
        if (typeof tokenString !== 'string') {
          console.error('[PartyService] CRITICAL: tokenString is not a string');
          console.error('[PartyService] Type is:', typeof tokenString);
          console.error('[PartyService] Value is:', tokenString);
          throw new Error(`Token has wrong type: ${typeof tokenString}`);
        }
        
        if (tokenString.trim() === '') {
          console.error('[PartyService] CRITICAL: Token is empty string');
          throw new Error('Token is empty string');
        }

        console.log('[PartyService] Token validated, length:', tokenString.length);
        
      } catch (tokenError) {
        console.error('[PartyService] ===== TOKEN GENERATION ERROR =====');
        console.error('[PartyService] Error message:', tokenError.message);
        console.error('[PartyService] Error stack:', tokenError.stack);
        console.error('[PartyService] ===================================');
        // DO NOT return null - always throw
        throw new Error(`Failed to generate JWT token: ${tokenError.message}`);
      }
      
      // CRITICAL: Final check before proceeding
      if (!tokenString || typeof tokenString !== 'string' || tokenString.trim() === '') {
        console.error('[PartyService] CRITICAL: Token validation failed after try-catch');
        console.error('[PartyService] tokenString:', tokenString);
        console.error('[PartyService] tokenString type:', typeof tokenString);
        throw new Error('Token validation failed after generation - this should never happen');
      }

      // Step 6: Verify party registration
      console.log('[PartyService] Verifying party registration...');
      const verification = await cantonAdmin.verifyPartyRegistration(partyId, tokenString);
      if (!verification.registered && verification.verified) {
        console.warn('[PartyService] Verification failed - party may not be fully registered');
      }

      // Step 7: Increment quota
      this.incrementQuota();

      // Step 8: One more validation before creating result
      if (!tokenString || typeof tokenString !== 'string' || tokenString.trim() === '') {
        console.error('[PartyService] CRITICAL: Token invalid before creating result');
        throw new Error('Token validation failed before creating result object');
      }
      
      console.log('[PartyService] About to create result object');
      console.log('[PartyService] tokenString type:', typeof tokenString);
      console.log('[PartyService] tokenString length:', tokenString.length);
      console.log('[PartyService] tokenString preview:', tokenString.substring(0, 50));

      // ============================================
      // CRITICAL: Create result with explicit assignments
      // Use temporary variables to ensure no mutation
      // ============================================
      const resultPartyId = String(partyId);
      const resultToken = String(tokenString);
      const resultQuotaStatus = {
        dailyUsed: quotaStatus.dailyCount + 1,
        dailyLimit: DAILY_QUOTA,
        weeklyUsed: quotaStatus.weeklyCount + 1,
        weeklyLimit: WEEKLY_QUOTA,
      };
      const resultRegistered = registrationResult?.success || false;
      const resultVerified = (verification?.verified && verification?.registered) || false;
      const resultMethod = registrationResult?.method || 'unknown';
      
      // Verify result token before creating object
      if (!resultToken || typeof resultToken !== 'string') {
        console.error('[PartyService] CRITICAL: resultToken is invalid');
        throw new Error('Result token validation failed');
      }
      
      const result = {
        partyId: resultPartyId,
        token: resultToken,
        quotaStatus: resultQuotaStatus,
        registered: resultRegistered,
        verified: resultVerified,
        registrationMethod: resultMethod,
      };
      
      // ============================================
      // FINAL VALIDATION
      // ============================================
      console.log('[PartyService] Result object created');
      console.log('[PartyService] result.token exists:', !!result.token);
      console.log('[PartyService] result.token type:', typeof result.token);
      console.log('[PartyService] result.token length:', result.token?.length);
      
      if (!result.token || typeof result.token !== 'string' || result.token.trim() === '') {
        console.error('[PartyService] CRITICAL: result.token is invalid after creation');
        console.error('[PartyService] result object keys:', Object.keys(result));
        console.error('[PartyService] result.token value:', result.token);
        console.error('[PartyService] tokenString value:', tokenString);
        throw new Error('Result object has invalid token after creation');
      }
      
      // Test JSON serialization
      console.log('[PartyService] Testing JSON serialization...');
      const testJson = JSON.stringify(result);
      const testParsed = JSON.parse(testJson);
      console.log('[PartyService] JSON test - parsed.token exists:', !!testParsed.token);
      console.log('[PartyService] JSON test - parsed.token type:', typeof testParsed.token);
      
      if (!testParsed.token) {
        console.error('[PartyService] CRITICAL: Token lost during JSON serialization!');
        console.error('[PartyService] Original result:', result);
        console.error('[PartyService] JSON string:', testJson);
        console.error('[PartyService] Parsed result:', testParsed);
        throw new Error('Token lost during JSON serialization test');
      }
      
      console.log('[PartyService] ===== RETURNING RESULT =====');
      console.log('[PartyService] Final result.token length:', result.token.length);
      
      return result;
      
    } catch (error) {
      console.error('[PartyService] Error creating party:', error);
      throw error;
    }
  }
}

module.exports = PartyService;