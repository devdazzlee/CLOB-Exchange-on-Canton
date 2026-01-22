/**
 * Party Controller
 * Handles party-related HTTP requests
 */

const PartyService = require('../services/party-service');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class PartyController {
  constructor() {
    this.partyService = new PartyService();
  }

  /**
   * Create a new party
   * Accepts publicKeyHex from frontend and creates party via external wallet flow
   */
  create = asyncHandler(async (req, res) => {
    const { publicKeyHex } = req.body;
    
    // Validate publicKeyHex
    if (!publicKeyHex || typeof publicKeyHex !== 'string') {
      return error(res, 'publicKeyHex is required and must be a string', 400);
    }
    
    // Validate it's a valid hex string
    if (!/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
      return error(res, 'publicKeyHex must be a valid hexadecimal string', 400);
    }
    
    // Call the service method that handles external wallet party creation
    const result = await this.partyService.createPartyForUser(publicKeyHex);
    return success(res, result, 'Party created successfully', 201);
  });

  /**
   * Get quota status
   */
  getQuotaStatus = asyncHandler(async (req, res) => {
    const status = await this.partyService.getQuotaStatus();
    return success(res, status, 'Quota status retrieved successfully');
  });
}

module.exports = new PartyController();
