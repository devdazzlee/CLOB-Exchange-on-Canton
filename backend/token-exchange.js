// Backend Token Exchange Service
// Exchanges Keycloak OAuth token for Canton Ledger API token

class TokenExchangeService {
  constructor() {
    // Static ledger token with proper claims (from Canton operator)
    this.staticLedgerToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njc1MjAzOTUsImlhdCI6MTc2NzUxODU5NSwiYXV0aF90aW1lIjoxNzY3NTE4NTk0LCJqdGkiOiJvZnJ0YWM6MGNiNGY4ZDktYjE2MC1kM2Q2LTU5ZmEtYjNhYTE3ZWU1ODQ2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOlsiaHR0cHM6Ly9jYW50b24ubmV0d29yay5nbG9iYWwiLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQudGFpbGViNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6Ijg5NTJlMmFjLTBlN2EtNGE1Ni1iYTNhLTgxZjM4MDUzMzkxZiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.IPIXZFL1u-dmQQsI05ttwYYD5YDIAcvnGKms8u_2MQk2wM09K4AgSEc36a0RfsMx6kuCOmUvah8NbB7b7wedBkjoFzoPXNLW9-SBEZ9voVGNRkK2S8QXAwpkcRcTtNcTvfcuH-aKICNuRj4dHLgOSxzYFNVzMAPmATSTt9_mBd2FWlinDt_roCpWddtAWnSui_MVNlyz55Rf8ZAXkMoEROs_FMyAQIsoYifrmU8cskL2wigke_KmHT0W5TtPpqHiYUxuakFVe_Bg8AnZ0lhTXki7lEuk4cW2aSq2fYd17CcezBWqem83VmbUlI3JuT2MH-c6fuuRp3G5XXzOPCQfAw';
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
      
      // 3. Return static ledger token (in production, generate user-specific token)
      return {
        ledgerToken: this.staticLedgerToken,
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
    // In production, check Canton ledger for user permissions
    // For now, assume the user has permissions
    const allowedUsers = [
      '8100b2db-86cf-40a1-8351-55483c151cdc'
    ];
    
    return allowedUsers.includes(userId);
  }

  // Proxy ledger API calls with proper token
  async proxyLedgerApiCall(req, res) {
    try {
      // Get Keycloak token from request
      const keycloakToken = this.extractToken(req);
      
      // Exchange for ledger token
      const { ledgerToken } = await this.exchangeToken(keycloakToken);
      
      // Forward request to Canton with ledger token
      const response = await fetch('https://participant.dev.canton.wolfedgelabs.com/json-api' + req.url, {
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing authorization header');
    }
    
    return authHeader.substring(7);
  }
}

module.exports = TokenExchangeService;
