/**
 * OAuth Token Service (for indexer)
 * Acquires access tokens from Keycloak for server-to-server calls
 */

import axios from 'axios';

const OAUTH_TOKEN_URL = process.env.OAUTH_TOKEN_URL || '';
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || '';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export class OAuthService {
  /**
   * Get OAuth access token using client credentials
   */
  async getAccessToken(): Promise<string> {
    try {
      const response = await axios.post<TokenResponse>(
        OAUTH_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data.access_token;
    } catch (error: any) {
      console.error('Failed to get OAuth token:', error.response?.data || error.message);
      throw new Error('Failed to acquire OAuth access token');
    }
  }
}
