/**
 * Admin Controller
 * Handles admin-related HTTP requests
 */

const orderBookService = require('../services/orderBookService');
const cantonService = require('../services/cantonService');
const CantonAdmin = require('../services/canton-admin');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');

class AdminController {
  /**
   * Create OrderBook for trading pair
   */
  createOrderBook = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);

    const result = await orderBookService.createOrderBook(decodedTradingPair);

    if (result.alreadyExists) {
      return success(
        res,
        {
          contractId: result.contractId,
          tradingPair: decodedTradingPair,
        },
        'OrderBook already exists',
        200
      );
    }

    return success(
      res,
      {
        contractId: result.contractId,
        masterOrderBookContractId: result.masterOrderBookContractId,
        tradingPair: decodedTradingPair,
      },
      'OrderBook created successfully',
      201
    );
  });

  /**
   * Upload DAR file
   */
  uploadDar = asyncHandler(async (req, res) => {
    const { darFile } = req.body;

    if (!darFile) {
      return error(res, 'DAR file is required', 400);
    }

    const cantonAdmin = new CantonAdmin();
    const adminToken = await cantonAdmin.getAdminToken();

    // Base64 decode and save temporarily
    const darBuffer = Buffer.from(darFile, 'base64');
    const tempPath = `/tmp/dar-${Date.now()}.dar`;
    require('fs').writeFileSync(tempPath, darBuffer);
    
    try {
      // Use curl to upload to Canton Admin API
      const { execSync } = require('child_process');
      const cantonAdminHost = process.env.CANTON_ADMIN_HOST || 'participant.dev.canton.wolfedgelabs.com';
      const cantonAdminPort = process.env.CANTON_ADMIN_PORT || '443';
      
      const protocol = cantonAdminPort === '443' ? 'https' : 'http';
      const command = `curl -X POST ${protocol}://${cantonAdminHost}:${cantonAdminPort}/v1/dars \
        -H "Authorization: Bearer ${adminToken}" \
        --data-binary @${tempPath}`;
      
      console.log('[Admin] Uploading DAR to Canton:', command);
      const output = execSync(command, { encoding: 'utf8' });
      
      // Clean up temp file
      require('fs').unlinkSync(tempPath);
      
      return success(res, { output }, 'DAR file uploaded successfully', 201);
    } catch (err) {
      // Clean up temp file on error
      if (require('fs').existsSync(tempPath)) {
        require('fs').unlinkSync(tempPath);
      }
      console.error('[Admin] DAR upload error:', err);
      return error(res, `Failed to upload DAR: ${err.message}`, 500);
    }
  });
}

module.exports = new AdminController();
