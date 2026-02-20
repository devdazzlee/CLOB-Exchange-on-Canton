/**
 * Party Controller — DEPRECATED
 * 
 * This controller only serves the legacy /api/create-party endpoint,
 * which now returns 410 Gone. All party creation uses external parties
 * via /api/onboarding/allocate-party or /api/wallet/create.
 */

const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class PartyController {
  constructor() {
    // No services needed — this endpoint is deprecated and returns 410.
  }

  /**
   * DEPRECATED: This endpoint is disabled.
   * Use the external party onboarding flow instead:
   *   POST /api/onboarding/allocate-party (2-step: topology → allocate)
   *   POST /api/wallet/create (v1 wallet API)
   */
  create = asyncHandler(async (req, res) => {
    return error(res,
      'This endpoint is deprecated. Use POST /api/onboarding/allocate-party (2-step flow) ' +
      'or POST /api/wallet/create instead. ' +
      'External parties ensure users control their own keys with Confirmation permission.',
      410 // 410 Gone
    );
  });

  /**
   * Get quota status
   * Quotas are not enforced for external party onboarding.
   */
  getQuotaStatus = asyncHandler(async (req, res) => {
    return success(res, {
      daily: { used: 0, limit: 100, remaining: 100 },
      weekly: { used: 0, limit: 500, remaining: 500 },
      message: 'Quotas are not enforced for external party onboarding.',
    }, 'Quota status retrieved successfully');
  });
}

module.exports = new PartyController();
