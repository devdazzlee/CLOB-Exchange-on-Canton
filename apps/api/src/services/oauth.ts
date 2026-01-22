/**
 * OAuth Token Service
 * Acquires access tokens from Keycloak for server-to-server calls
 */

import axios, { AxiosRequestConfig } from 'axios';
import https from 'https';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Clean and validate environment URL
 * - Trims whitespace
 * - Removes surrounding quotes (normal and smart quotes)
 * - Validates URL format
 */
function cleanEnvUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error('Missing environment variable');
  }

  // Trim whitespace
  let cleaned = raw.trim();

  // Remove surrounding quotes (normal and smart quotes)
  cleaned = cleaned.replace(/^["'""]+/, '').replace(/["'""]+$/, '');

  // Detect remaining smart quotes (common copy/paste issue)
  if (/[""]/.test(cleaned)) {
    throw new Error(
      `URL contains smart quotes. Fix your .env value to plain ASCII: ${JSON.stringify(cleaned)}`
    );
  }

  // Validate URL format
  try {
    new URL(cleaned);
  } catch {
    throw new Error(`Invalid URL format: ${JSON.stringify(raw)}`);
  }

  return cleaned;
}

export class OAuthService {
  private cachedToken?: CachedToken;

  /**
   * Get OAuth access token using client credentials
   * Caches token until expiry minus 30 seconds
   */
  async getAccessToken(): Promise<string> {
    // Read environment variables
    const rawTokenUrl = process.env.CANTON_OAUTH_TOKEN_URL;
    const clientId = process.env.CANTON_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CANTON_OAUTH_CLIENT_SECRET;

    // Validate required env vars
    if (!rawTokenUrl) {
      throw new Error('Missing env CANTON_OAUTH_TOKEN_URL');
    }
    if (!clientId) {
      throw new Error('Missing env CANTON_OAUTH_CLIENT_ID');
    }
    if (!clientSecret) {
      throw new Error('Missing env CANTON_OAUTH_CLIENT_SECRET');
    }

    // Clean and validate URL
    const tokenUrl = cleanEnvUrl(rawTokenUrl);

    // Log cleaned URL (without secrets) for debugging
    console.log(`[OAuth] Token URL: ${tokenUrl}`);

    // Check cache (expire 30 seconds before actual expiry)
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.token;
    }

    // Build request body
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    // Configure axios options
    const axiosConfig: AxiosRequestConfig = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: body.toString(),
    };

    // Add insecure TLS support for dev (when CANTON_OAUTH_INSECURE_TLS=true)
    if (process.env.CANTON_OAUTH_INSECURE_TLS === 'true') {
      console.warn('[OAuth] WARNING: Using insecure TLS (rejectUnauthorized: false)');
      axiosConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    // Make request
    let response;
    try {
      response = await axios.post<TokenResponse>(tokenUrl, body.toString(), axiosConfig);
    } catch (error: any) {
      if (error.response) {
        // Server responded with error
        throw new Error(
          `OAuth token request failed (${error.response.status}): ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        // Request made but no response
        throw new Error(`Failed to connect to OAuth endpoint: ${error.message}`);
      } else {
        // Error setting up request
        throw new Error(`OAuth request setup failed: ${error.message}`);
      }
    }

    const json = response.data;
    if (!json.access_token) {
      throw new Error(`OAuth response missing access_token: ${JSON.stringify(json)}`);
    }

    // Cache token (expires_in is in seconds)
    const expiresInMs = (json.expires_in ?? 1800) * 1000;
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + expiresInMs,
    };
    
    // Log only last 6 chars of token for security
    const tokenPreview = json.access_token.slice(-6);
    console.log(`[OAuth] Successfully acquired new token (ending in: ...${tokenPreview})`);

    return json.access_token;
  }

  /**
   * Exchange user token (for user-specific operations)
   * This would be used when the frontend sends a user token
   */
  async exchangeUserToken(userToken: string): Promise<string> {
    // For now, return the user token as-is
    // In production, you might need to exchange it for a ledger token
    return userToken;
  }
}
