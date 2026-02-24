/**
 * Token Provider - SERVICE TOKEN ONLY
 * 
 * Backend uses client_credentials to get service token for Canton API calls.
 * End-users NEVER interact with Keycloak - they use app-level sessions + signatures.
 * 
 * NO STATIC JWTS IN CODE. NO USER TOKEN EXCHANGE.
 */

// Keep TLS verification enabled by default. If an environment explicitly
// sets NODE_TLS_REJECT_UNAUTHORIZED=0, Node will still allow insecure TLS
// and emit its own warning.

const config = require('../config');

class TokenProvider {
    constructor() {
        // Cache: key -> { token, expiresAt }
        this.cache = new Map();

        // Expiry skew - refresh before actual expiry
        this.expirySkewMs = 60 * 1000; // 60 seconds
    }

    /**
     * Get service/admin token for backend operations ONLY
     * Uses client credentials flow - NO user interaction
     */
    async getServiceToken() {
        const cacheKey = 'service';
        const cached = this.cache.get(cacheKey);

        if (cached && !this.isExpired(cached.expiresAt)) {
            return cached.token;
        }

        // Fetch new service token
        const token = await this.fetchServiceToken();
        const expiresAt = this.extractExpiry(token);

        this.cache.set(cacheKey, { token, expiresAt });
        return token;
    }

    /**
     * Check if a cached token is expired (with skew)
     */
    isExpired(expiresAt) {
        if (!expiresAt) return true;
        return Date.now() >= (expiresAt - this.expirySkewMs);
    }

    /**
     * Extract expiry from JWT token
     */
    extractExpiry(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;

            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            if (payload.exp) {
                return payload.exp * 1000; // Convert to milliseconds
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Fetch service token using client credentials
     * Backend ONLY - never exposed to end-users
     */
    async fetchServiceToken() {
        const tokenUrl = config.canton.oauth?.tokenUrl;
        const clientId = config.canton.oauth?.clientId;
        const clientSecret = config.canton.oauth?.clientSecret;
        const audience = config.canton.oauth?.audience;

        if (!tokenUrl || !clientId || !clientSecret) {
            throw new Error('OAuth configuration incomplete for service token');
        }

        // Debug: Log client ID (first 10 chars only for security) and check for whitespace
        const trimmedClientId = clientId?.trim();
        const trimmedClientSecret = clientSecret?.trim();
        
        console.log('[TokenProvider] Raw client ID from config:', clientId ? `"${clientId}"` : 'MISSING');
        console.log('[TokenProvider] Trimmed client ID:', trimmedClientId ? `"${trimmedClientId}"` : 'MISSING');
        console.log('[TokenProvider] Client ID length (raw):', clientId?.length || 0);
        console.log('[TokenProvider] Client ID length (trimmed):', trimmedClientId?.length || 0);
        console.log('[TokenProvider] Client secret length:', trimmedClientSecret?.length || 0);
        console.log('[TokenProvider] Token URL:', tokenUrl);
        
        if (trimmedClientId !== clientId) {
            console.warn('[TokenProvider] WARNING: Client ID had leading/trailing whitespace!');
        }
        if (trimmedClientSecret !== clientSecret) {
            console.warn('[TokenProvider] WARNING: Client secret had leading/trailing whitespace!');
        }
        
        // Validate expected client ID format (validator-app client ID)
        const expectedClientId = 'Sesnp3u6udkFF983rfprvsBbx3X3mBpw'; // 34 characters with "Se" prefix
        if (trimmedClientId !== expectedClientId) {
            console.error('[TokenProvider] ERROR: Client ID mismatch!');
            console.error('[TokenProvider] Expected:', expectedClientId, `(${expectedClientId.length} chars)`);
            console.error('[TokenProvider] Got:', trimmedClientId, `(${trimmedClientId?.length || 0} chars)`);
            console.error('[TokenProvider] ⚠️  Update .env: OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw');
        } else {
            console.log('[TokenProvider] ✅ Client ID matches expected format');
        }

        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', trimmedClientId);
        params.append('client_secret', trimmedClientSecret);
        // Required scope for ledger access
        params.append('scope', config.canton.oauth.scope || 'openid profile email daml_ledger_api');
        if (audience) {
            params.append('audience', audience);
        }

        console.log('[TokenProvider] Request URL:', tokenUrl);
        console.log('[TokenProvider] Request params (without secret):', {
            grant_type: 'client_credentials',
            client_id: trimmedClientId,
            client_secret: '[REDACTED]',
            scope: config.canton.oauth.scope || 'openid profile email daml_ledger_api',
            ...(audience && { audience })
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TokenProvider] Token request failed:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            throw new Error(`Failed to fetch service token: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    /**
     * Invalidate cached token
     */
    invalidate(cacheKey) {
        this.cache.delete(cacheKey);
    }

    /**
     * Clear all cached tokens
     */
    clearAll() {
        this.cache.clear();
    }
}

// Singleton instance
module.exports = new TokenProvider();
