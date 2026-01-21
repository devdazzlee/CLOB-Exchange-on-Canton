/**
 * Auth Controller
 * Handles authentication-related HTTP requests
 */

const TokenExchangeService = require('../services/token-exchange');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');

class AuthController {
  constructor() {
    this.tokenExchange = new TokenExchangeService();
  }

  /**
   * Exchange token
   */
  exchangeToken = asyncHandler(async (req, res) => {
    const { keycloakToken } = req.body;

    if (!keycloakToken) {
      throw new ValidationError('keycloakToken is required');
    }

    const result = await this.tokenExchange.exchangeToken(keycloakToken);
    return success(res, result, 'Token exchanged successfully');
  });

  /**
   * Inspect token
   */
  inspectToken = asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
      throw new ValidationError('token is required');
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new ValidationError('Invalid token format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return success(res, {
        payload,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      }, 'Token inspected successfully');
    } catch (err) {
      throw new ValidationError('Failed to decode token');
    }
  });
}

module.exports = new AuthController();
