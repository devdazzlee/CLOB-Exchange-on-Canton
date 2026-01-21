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

    // Base64 decode and upload
    const darBuffer = Buffer.from(darFile, 'base64');
    
    // Use gRPC to upload DAR
    const CantonGrpcClient = require('../services/canton-grpc-client');
    const grpcClient = new CantonGrpcClient();
    
    const result = await grpcClient.uploadDar(darBuffer, adminToken);

    return success(res, result, 'DAR file uploaded successfully', 201);
  });
}

module.exports = new AdminController();
