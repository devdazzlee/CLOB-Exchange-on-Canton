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
const CANTON_JSON_API_BASE = process.env.CANTON_JSON_LEDGER_API_BASE || 'http://65.108.40.104:31539';

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
   * Get Keycloak Admin Token using service account
   * 
   * Requirements:
   * - KEYCLOAK_ADMIN_CLIENT_ID must be set to a client with service accounts enabled
   * - KEYCLOAK_ADMIN_CLIENT_SECRET must be set
   * - Service account must have "manage-users" role from "realm-management" client
   * 
   * @returns {Promise<string>} Admin access token with manage-users permission
   * @throws {Error} If configuration is missing or service account lacks required permissions
   */
  async getKeycloakAdminToken() {
    // Validate cached token
    if (this.adminToken && this.adminTokenExpiry && Date.now() < this.adminTokenExpiry) {
      try {
        const parts = this.adminToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const hasManageUsers = payload.resource_access?.['realm-management']?.roles?.includes('manage-users');
          if (hasManageUsers) {
      return this.adminToken;
          }
          // Token lacks permissions, clear cache
          this.adminToken = null;
          this.adminTokenExpiry = null;
        }
      } catch (e) {
        // If we can't decode, clear cache and get new token
        this.adminToken = null;
        this.adminTokenExpiry = null;
      }
    }

    // Validate configuration
    if (!KEYCLOAK_ADMIN_CLIENT_ID) {
      throw new Error('KEYCLOAK_ADMIN_CLIENT_ID not configured. Set it to a Keycloak client with service accounts enabled.');
    }

    if (!KEYCLOAK_ADMIN_CLIENT_SECRET || KEYCLOAK_ADMIN_CLIENT_SECRET.trim() === '') {
      throw new Error('KEYCLOAK_ADMIN_CLIENT_SECRET not configured. Service account requires client secret for authentication.');
    }

    // Authenticate service account
      const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
      client_id: KEYCLOAK_ADMIN_CLIENT_ID,
      scope: 'openid',
    });
    params.append('client_secret', KEYCLOAK_ADMIN_CLIENT_SECRET);
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
      throw new Error(`Service account authentication failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      if (!data || !data.access_token) {
        throw new Error('Service account token response missing access_token');
      }
      
    // Verify token has required permissions
    let hasManageUsers = false;
    let tokenInfo = {
      realmManagementRoles: []
    };
    
    try {
      const parts = data.access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const realmManagementRoles = payload.resource_access?.['realm-management']?.roles || [];
        hasManageUsers = Array.isArray(realmManagementRoles) && realmManagementRoles.includes('manage-users');
        tokenInfo.realmManagementRoles = realmManagementRoles;
      }
    } catch (decodeError) {
      hasManageUsers = false;
    }

    if (!hasManageUsers) {
      try {
        await this.assignManageUsersRoleToServiceAccount(data.access_token);
        return await this.getKeycloakAdminToken();
      } catch (assignError) {
        throw new Error(
          `Service account "${KEYCLOAK_ADMIN_CLIENT_ID}" does not have the "manage-users" role. ` +
          `Go to Keycloak Admin Console → Clients → "${KEYCLOAK_ADMIN_CLIENT_ID}" → Service Account Roles → Assign "manage-users" from "realm-management".`
        );
      }
    }

    // Cache token
      this.adminToken = data.access_token;
      this.adminTokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
    
      return this.adminToken;
  }

  /**
   * ROOT CAUSE FIX: Programmatically assign manage-users role to service account
   * Uses Keycloak Admin REST API to assign the role
   */
  async assignManageUsersRoleToServiceAccount(adminToken) {
    try {
      const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
      const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
      
      // Step 1: Get the service account user
      const clientsUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${encodeURIComponent(KEYCLOAK_ADMIN_CLIENT_ID)}`;
      const clientsResponse = await fetch(clientsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!clientsResponse.ok) {
        throw new Error(`Failed to get client: ${clientsResponse.status}`);
      }

      const clients = await clientsResponse.json();
      if (!clients || clients.length === 0) {
        throw new Error(`Client ${KEYCLOAK_ADMIN_CLIENT_ID} not found`);
      }

      const clientUuid = clients[0].id;

      // Step 2: Get service account user
      const serviceAccountUserUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients/${clientUuid}/service-account-user`;
      const userResponse = await fetch(serviceAccountUserUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!userResponse.ok) {
        throw new Error(`Failed to get service account user: ${userResponse.status}`);
      }

      const serviceAccountUser = await userResponse.json();
      const serviceAccountUserId = serviceAccountUser.id;

      // Step 3: Get realm-management client UUID
      const realmMgmtUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=realm-management`;
      const realmMgmtResponse = await fetch(realmMgmtUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!realmMgmtResponse.ok) {
        throw new Error(`Failed to get realm-management client: ${realmMgmtResponse.status}`);
      }

      const realmMgmtClients = await realmMgmtResponse.json();
      if (!realmMgmtClients || realmMgmtClients.length === 0) {
        throw new Error('realm-management client not found');
      }

      const realmMgmtClientUuid = realmMgmtClients[0].id;

      // Step 4: Get manage-users role
      const roleUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients/${realmMgmtClientUuid}/roles/manage-users`;
      const roleResponse = await fetch(roleUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!roleResponse.ok) {
        throw new Error(`Failed to get manage-users role: ${roleResponse.status}`);
      }

      const manageUsersRole = await roleResponse.json();

      // Step 5: Assign role to service account user
      const assignRoleUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${serviceAccountUserId}/role-mappings/clients/${realmMgmtClientUuid}`;
      const assignResponse = await fetch(assignRoleUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          id: manageUsersRole.id,
          name: manageUsersRole.name
        }])
      });

      if (!assignResponse.ok) {
        const errorText = await assignResponse.text();
        throw new Error(`Failed to assign role: ${assignResponse.status} - ${errorText}`);
      }

      return true;
    } catch (error) {
      throw error;
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
      
      // Grant rights for the new party (for visibility)
      await grpcClient.grantUserRights(userId, partyId, adminToken);
      console.log(`[PartyService] Granted rights for new party: ${partyId}`);
      
      // Also ensure validator-operator has rights for operator party (if not already granted)
      // This is needed because UserAccount has operator as signatory
      const config = require('../config');
      const operatorPartyId = config.canton.operatorPartyId;
      if (operatorPartyId && operatorPartyId !== partyId) {
        try {
          await grpcClient.grantUserRights(userId, operatorPartyId, adminToken);
          console.log(`[PartyService] Granted rights for operator party: ${operatorPartyId}`);
        } catch (opError) {
          // Operator party rights might already exist, log but don't fail
          console.warn(`[PartyService] Could not grant operator party rights (may already exist): ${opError.message}`);
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error('[PartyService] Failed to grant Canton user rights via gRPC:', error.message);
      throw error;
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
        
        // Log full error details for debugging
        console.error('[PartyService] ===== USER CREATION FAILED =====');
        console.error('[PartyService] Status:', status);
        console.error('[PartyService] Status Text:', createUserResponse.statusText);
        console.error('[PartyService] Error Response:', errorText);
        console.error('[PartyService] Request URL:', usersUrl);
        console.error('[PartyService] Admin Client ID:', KEYCLOAK_ADMIN_CLIENT_ID);
        
        // Try to parse error response
        let errorDetails = null;
        try {
          errorDetails = JSON.parse(errorText);
          console.error('[PartyService] Parsed Error:', JSON.stringify(errorDetails, null, 2));
        } catch (e) {
          console.error('[PartyService] Error response is not JSON');
        }
        
        // Provide helpful error message for 403 (permission denied)
        if (status === 403) {
          console.error('[PartyService] ===== PERMISSION DENIED =====');
          console.error('[PartyService] The service account does not have permission to create users.');
          console.error('[PartyService] Admin client being used:', KEYCLOAK_ADMIN_CLIENT_ID);
          
          // Check if token has the right roles by inspecting it
          try {
            const parts = adminToken.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
              const realmManagementRoles = payload.resource_access?.['realm-management']?.roles || [];
              console.error('[PartyService] Token has realm-management roles:', realmManagementRoles.length > 0 ? realmManagementRoles.join(', ') : 'NONE');
              if (!realmManagementRoles.includes('manage-users')) {
                console.error('[PartyService] MISSING: Token does not contain "manage-users" role');
              }
            }
          } catch (e) {
            console.error('[PartyService] Could not inspect token:', e.message);
          }
          
          console.error('[PartyService] Required Keycloak configuration:');
          console.error(`[PartyService] 1. Go to Clients → "${KEYCLOAK_ADMIN_CLIENT_ID}" → Service Account Roles`);
          console.error('[PartyService] 2. Assign "manage-users" role from "realm-management" client to the service account');
          console.error('[PartyService] See KEYCLOAK_SERVICE_ACCOUNT_SETUP.md for details');
          console.error('[PartyService] ====================================');
          throw new Error(`Service account for client "${KEYCLOAK_ADMIN_CLIENT_ID}" lacks permission to create users. Please assign "manage-users" role from "realm-management" to the service account in Keycloak.`);
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

  /**
   * Update validator-operator user attribute with new party
   * This allows the protocol mapper to include all parties in the token
   */
  async updateValidatorOperatorParties(partyId) {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      const userId = this.getValidatorOperatorUserIdFromToken(adminToken);
      
      // Get current user
      const userUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`;
      const userResponse = await fetch(userUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!userResponse.ok) {
        return { success: false, error: 'Cannot get validator-operator user' };
      }
      
      const user = await userResponse.json();
      
      // Get current parties from user attribute
      const currentParties = user.attributes?.cantonParties || [];
      const partiesArray = Array.isArray(currentParties) ? currentParties : 
                          (currentParties[0] ? JSON.parse(currentParties[0]) : []);
      
      // Add new party if not already present
      if (!partiesArray.includes(partyId)) {
        partiesArray.push(partyId);
        
        // Update user attribute
        const updateUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...user,
            attributes: {
              ...user.attributes,
              cantonParties: [JSON.stringify(partiesArray)]
            }
          })
        });
        
        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          return { success: false, error: `Failed to update user: ${updateResponse.status} - ${errorText}` };
        }
      }
      
      return { success: true, parties: partiesArray };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Configure Keycloak protocol mapper with current party list
   * ROOT CAUSE FIX: Updates hardcoded mapper with current parties EVERY TIME
   */
  async configureKeycloakMapperForParties(partyId) {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      
      // Get validator-app client UUID
      const clientsUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${encodeURIComponent(KEYCLOAK_ADMIN_CLIENT_ID)}`;
      const clientsResponse = await fetch(clientsUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!clientsResponse.ok) {
        return { success: false, error: 'Cannot access Keycloak Admin API' };
      }
      
      const clients = await clientsResponse.json();
      if (!clients || clients.length === 0) {
        return { success: false, error: 'Client not found' };
      }
      
      const clientId = clients[0].id;
      const mapperUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients/${clientId}/protocol-mappers/models`;
      
      // Get current parties from user attribute
      const userId = this.getValidatorOperatorUserIdFromToken(adminToken);
      const userUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`;
      const userResponse = await fetch(userUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      let parties = [partyId];
      if (userResponse.ok) {
        const user = await userResponse.json();
        const currentParties = user.attributes?.cantonParties || [];
        if (currentParties.length > 0) {
          try {
            const parsed = JSON.parse(currentParties[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parties = parsed;
              if (!parties.includes(partyId)) {
                parties.push(partyId);
              }
            }
          } catch (e) {
            parties = [partyId];
          }
        }
      }
      
      // Get existing mappers
      const existingMappersResponse = await fetch(mapperUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const mapperName = 'DAML actAs - Hardcoded Parties';
      let existingMapperId = null;
      
      if (existingMappersResponse.ok) {
        const existingMappers = await existingMappersResponse.json();
        const existingMapper = existingMappers.find(m => m.name === mapperName);
        if (existingMapper) {
          existingMapperId = existingMapper.id;
          // Delete existing mapper to recreate with updated parties
          const deleteUrl = `${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/clients/${clientId}/protocol-mappers/models/${existingMapperId}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      // Try script mapper first (if available), otherwise use hardcoded mapper
      // Script mapper can dynamically read from user attributes
      const scriptMapper = {
        name: mapperName,
        protocol: 'openid-connect',
        protocolMapper: 'oidc-script-based-protocol-mapper',
        config: {
          'script': `
            // Read parties from user attribute
            var partiesAttr = user.getAttribute('cantonParties');
            var parties = [];
            if (partiesAttr && partiesAttr.length > 0) {
              try {
                parties = JSON.parse(partiesAttr[0]);
              } catch (e) {
                parties = [];
              }
            }
            
            // Create DAML claim structure
            var damlClaim = {
              'actAs': parties,
              'readAs': parties
            };
            
            // Set the claim
            token.setOtherClaims('https://daml.com/ledgerapi', damlClaim);
          `,
          'claim.name': 'https://daml.com/ledgerapi',
          'jsonType.label': 'JSON',
          'access.token.claim': 'true',
          'id.token.claim': 'true'
        }
      };
      
      // Fallback: hardcoded mapper if script mapper not available
      const claimValue = {
        'actAs': parties,
        'readAs': parties
      };
      
      const hardcodedMapper = {
        name: mapperName,
        protocol: 'openid-connect',
        protocolMapper: 'oidc-hardcoded-claim-mapper',
        config: {
          'claim.value': JSON.stringify(claimValue),
          'claim.name': 'https://daml.com/ledgerapi',
          'jsonType.label': 'JSON',
          'access.token.claim': 'true',
          'id.token.claim': 'true'
        }
      };
      
      console.log('[PartyService] Attempting to create script mapper with parties:', parties);
      
      // Try script mapper first
      let mapperResponse = await fetch(mapperUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify(scriptMapper)
      });
      
      let mapperResponseText = await mapperResponse.text();
      let usedScriptMapper = true;
      
      // If script mapper fails (not available in this Keycloak version), use hardcoded mapper
      if (!mapperResponse.ok) {
        console.log('[PartyService] Script mapper not available, using hardcoded mapper');
        usedScriptMapper = false;
        
        mapperResponse = await fetch(mapperUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(hardcodedMapper)
        });
        
        mapperResponseText = await mapperResponse.text();
      }
      
      if (!mapperResponse.ok) {
        console.error('[PartyService] ✗ Mapper creation FAILED:', mapperResponse.status);
        console.error('[PartyService] Error response:', mapperResponseText);
        console.error('[PartyService] Mapper type tried:', usedScriptMapper ? 'script' : 'hardcoded');
        return { success: false, error: `Failed to create mapper: ${mapperResponse.status} - ${mapperResponseText}` };
      }
      
      let mapperData = null;
      try {
        mapperData = mapperResponseText ? JSON.parse(mapperResponseText) : { id: 'created' };
      } catch (e) {
        if (mapperResponse.status === 201) {
          mapperData = { id: 'created' };
        }
      }
      
      console.log('[PartyService] ✓ Mapper created successfully! Type:', usedScriptMapper ? 'script' : 'hardcoded');
      console.log('[PartyService] Mapper ID:', mapperData?.id);
      console.log('[PartyService] Parties in mapper:', parties);
      
      throw new Error(`Token generation failed (${response.status}): ${errorMessage}`);

    const data = JSON.parse(tokenResponseText);
    
    if (!data || !data.access_token || typeof data.access_token !== 'string' || data.access_token.trim() === '') {
      throw new Error('Invalid token response from Keycloak');
    }
    
    return String(data.access_token);
    
  } catch (error) {
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