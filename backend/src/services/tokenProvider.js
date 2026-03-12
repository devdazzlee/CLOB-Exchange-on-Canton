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
const { getAuthApi } = require('../http/clients');

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

        const trimmedClientId = clientId?.trim();
        const trimmedClientSecret = clientSecret?.trim();

        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', trimmedClientId);
        params.append('client_secret', trimmedClientSecret);
        // Required scope for ledger access
        params.append('scope', config.canton.oauth.scope || 'openid profile email daml_ledger_api');
        if (audience) {
            params.append('audience', audience);
        }

        try {
            const response = await getAuthApi().post(tokenUrl, params.toString());
            return response.data.access_token;
        } catch (error) {
            if (error.response) {
                const errorText = typeof error.response.data === 'string'
                    ? error.response.data : JSON.stringify(error.response.data);
                console.error('[TokenProvider] Token request failed:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    error: errorText
                });
                throw new Error(`Failed to fetch service token: ${error.response.status} - ${errorText}`);
            }
            throw error;
        }
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
