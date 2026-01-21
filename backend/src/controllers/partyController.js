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
   */
  create = asyncHandler(async (req, res) => {
    const { displayName } = req.body;
    const result = await this.partyService.createParty(displayName);
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
