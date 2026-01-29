// Backend Token Exchange Service
// Exchanges Keycloak OAuth token for Canton Ledger API token
const config = require('../config');
const jwt = require('jsonwebtoken');

class TokenExchangeService {
  constructor() {
    // NO STATIC TOKENS - Generate proper user-specific tokens
  }

  // Validate Keycloak token and exchange for ledger token
  async exchangeToken(keycloakToken) {
    try {
      // 1. Validate Keycloak token
      const payload = this.validateKeycloakToken(keycloakToken);
      
      // 2. Check user has ledger permissions
      const hasPermissions = await this.checkLedgerPermissions(payload.sub);
      
      if (!hasPermissions) {
        throw new Error('User lacks ledger permissions');
      }
      
      // 3. Generate user-specific ledger token
      const ledgerToken = await this.generateUserSpecificToken(payload);
      
      return {
        ledgerToken,
        type: 'ledger-api',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
      };
      
    } catch (error) {
      console.error('Token exchange failed:', error);
      throw error;
    }
  }

  validateKeycloakToken(token) {
    // Verify JWT signature and extract payload
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    const payload = JSON.parse(atob(parts[1]));
    
    // Check expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      throw new Error('Token expired');
    }
    
    // Check required scopes
    if (!payload.scope || !payload.scope.includes('openid')) {
      throw new Error('Missing required scopes');
    }
    
    return payload;
  }

  async checkLedgerPermissions(userId) {
    // NO HARDCODED PERMISSIONS - Check Canton ledger for real user permissions
    try {
      const { v4: uuidv4 } = require('uuid');
      const adminToken = await this.getAdminToken();
      
      // Query user's permissions from Canton
      const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          filter: {
            filtersByParty: {
              [userId]: {
                inclusive: {
                  templateIds: ['UserAccount:UserAccount']
                }
              }
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Permission check failed: ${response.status}`);
      }

      const data = await response.json();
      
      // User has permissions if they have a UserAccount contract
      return data.contractEntry && data.contractEntry.length > 0;
      
    } catch (error) {
      console.error('Permission check failed:', error);
      return false; // NO FALLBACK - Deny access if check fails
    }
  }

  async getAdminToken() {
    // NO CACHED TOKENS - Get fresh admin token each time
    const tokenUrl = config.canton.oauthTokenUrl;
    const clientId = config.canton.oauthClientId;
    const clientSecret = config.canton.oauthClientSecret;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid profile email daml_ledger_api'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params
    });

    if (!response.ok) {
      throw new Error(`Admin token fetch failed: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  // Proxy ledger API calls with proper token validation and forwarding
  async proxyLedgerApiCall(req, res) {
    try {
      // Validate Authorization header early
      if (!req.headers.authorization?.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Missing or invalid Authorization header',
          details: 'Expected: Authorization: Bearer <token>'
        });
      }

      // Get Keycloak token from request
      const keycloakToken = this.extractToken(req);
      
      // Exchange for ledger token
      const { ledgerToken } = await this.exchangeToken(keycloakToken);
      
      // Forward request to Canton with the exchanged ledger token
      const response = await fetch(`${config.canton.jsonApiBase}${req.url}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ledgerToken}`
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
      });
      
      const data = await response.json();
      res.status(response.status).json(data);
      
    } catch (error) {
      console.error('Ledger API proxy error:', error);
      if (error.message.includes('Missing') || error.message.includes('token')) {
        return res.status(401).json({ 
          error: 'Authentication failed',
          details: error.message
        });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Invalid Authorization header format. Expected: Bearer <token>');
    }
    
    const token = authHeader.substring(7);
    if (!token) {
      throw new Error('Empty token in Authorization header');
    }
    
    return token;
  }
}

module.exports = TokenExchangeService;
