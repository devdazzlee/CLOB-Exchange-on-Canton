// Frontend Ledger API Service with Token Exchange
class LedgerApiService {
  constructor() {
    this.backendUrl = process.env.NODE_ENV === 'production' 
      ? 'https://your-backend.com' 
      : 'http://localhost:3001';
    this.ledgerToken = null;
    this.tokenExpiry = null;
  }

  // Exchange Keycloak token for ledger token
  async exchangeToken(keycloakToken) {
    try {
      const response = await fetch(`${this.backendUrl}/api/token-exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keycloakToken })
      });

      if (!response.ok) {
        throw new Error('Token exchange failed');
      }

      const data = await response.json();
      this.ledgerToken = data.ledgerToken;
      this.tokenExpiry = new Date(data.expiresAt);

      return data;
    } catch (error) {
      console.error('Token exchange error:', error);
      throw error;
    }
  }

  // Get valid ledger token
  async getLedgerToken() {
    // Check if token is still valid
    if (this.ledgerToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.ledgerToken;
    }

    // Get fresh Keycloak token
    const keycloakToken = await this.getKeycloakToken();
    
    // Exchange for ledger token
    await this.exchangeToken(keycloakToken);
    
    return this.ledgerToken;
  }

  async getKeycloakToken() {
    // Get token from your existing auth service
    const token = localStorage.getItem('canton_jwt_token');
    if (!token) {
      throw new Error('No Keycloak token available');
    }
    return token;
  }

  // Make authenticated ledger API calls
  async callLedgerApi(endpoint, options = {}) {
    try {
      const token = await this.getLedgerToken();
      
      const response = await fetch(`${this.backendUrl}/api/ledger${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Ledger API error:', error);
      throw error;
    }
  }

  // Example API methods
  async getActiveContracts(readAs) {
    return this.callLedgerApi('/v2/state/active-contracts', {
      method: 'POST',
      body: JSON.stringify({
        readAs: [readAs],
        activeAtOffset: "0",
        verbose: false
      })
    });
  }

  async submitCommand(command) {
    return this.callLedgerApi('/v2/commands/submit-and-wait', {
      method: 'POST',
      body: JSON.stringify(command)
    });
  }
}

export default new LedgerApiService();
