/**
 * Admin Controller
 * Handles admin-related HTTP requests
 */

const { getOrderBookService } = require('../services/orderBookService');
const cantonService = require('../services/cantonService');
const CantonAdmin = require('../services/canton-admin');
const tokenProvider = require('../services/tokenProvider');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');

class AdminController {
  /**
   * Get all OrderBooks
   */
  getOrderBooks = asyncHandler(async (req, res) => {
    const orderBookSvc = getOrderBookService();
    // Initialize if needed
    if (orderBookSvc.initialize) {
      await orderBookSvc.initialize();
    }
    const orderBooks = await orderBookSvc.getAllOrderBooks();
    return success(res, { orderBooks }, 'OrderBooks retrieved', 200);
  });

  /**
   * Create OrderBook for trading pair
   */
  createOrderBook = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);

    const orderBookSvc = getOrderBookService();
    if (orderBookSvc.initialize) {
      await orderBookSvc.initialize();
    }
    const result = await orderBookSvc.createOrderBook(decodedTradingPair);

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
    const { darFile, darPath } = req.body;

    const cantonAdmin = new CantonAdmin();

    // Base64 decode and save temporarily
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const darBuffer = darPath
      ? fs.readFileSync(path.isAbsolute(darPath) ? darPath : path.resolve(process.cwd(), darPath))
      : Buffer.from(darFile, 'base64');

    // Use OS temp directory (Windows-safe). This keeps the temp file compatible
    // with Node on Windows as well.
    const tempPath = path.join(os.tmpdir(), `dar-${Date.now()}.dar`);
    fs.writeFileSync(tempPath, darBuffer);

    try {
      const cantonAdminHost = config.canton.adminHost;
      const cantonAdminPort = config.canton.adminPort;

      if (!cantonAdminHost || !cantonAdminPort) {
        return error(res, 'CANTON_ADMIN_HOST and CANTON_ADMIN_PORT are required for DAR upload', 400);
      }

      // Use gRPC upload (the HTTP `/v1/dars` path is returning 502 in this environment).
      // Service confirmed by probing with grpcurl: com.digitalasset.canton.admin.participant.v30.PackageService/UploadDar
      const grpcurlBin = process.env.GRPCURL_BIN || 'grpcurl';
      const serviceFqn = 'com.digitalasset.canton.admin.participant.v30.PackageService/UploadDar';

      const requestPayload = {
        dars: [{ bytes: darBuffer.toString('base64') }],
        vet_all_packages: true,
        synchronize_vetting: true,
      };
      const requestJson = JSON.stringify(requestPayload);

      // Retry on expired OAuth tokens / unauthenticated errors.
      const maxAttempts = 3;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const adminToken = await cantonAdmin.getAdminToken();
        const { spawn } = require('child_process');

        try {
          const grpcArgs = [
            '-plaintext',
            '-max-time',
            '120',
            '-H',
            `Authorization: Bearer ${adminToken}`,
            '-d',
            '@',
            `${cantonAdminHost}:${cantonAdminPort}`,
            serviceFqn,
          ];

          const child = spawn(grpcurlBin, grpcArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
          child.stdin.write(requestJson);
          child.stdin.end();

          const { stdout, stderr, code: exitCode } = await new Promise((resolve, reject) => {
            let out = '';
            let err = '';
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.stderr.on('data', (d) => { err += d.toString(); });
            child.on('error', reject);
            child.on('close', (code) => resolve({ stdout: out, stderr: err, code }));
          });

          // If grpcurl exited 0, treat as success.
          // grpcurl returns empty stdout sometimes; rely on exit code instead.
          // We only have stdout/stderr here, so treat non-empty stderr as suspicious.
          if (stderr && stderr.toLowerCase().includes('unauthenticated') && attempt < maxAttempts) {
            console.warn(`[Admin] DAR upload attempt ${attempt}/${maxAttempts} returned unauthenticated — refreshing token and retrying...`);
            tokenProvider.invalidate('service');
            continue;
          }

          if (exitCode !== 0) {
            throw new Error(stderr.slice(0, 1000));
          }

          // Note: grpcurl doesn't always provide a structured body; return raw stdout/stderr.
          return success(res, { output: stdout || stderr }, 'DAR file uploaded successfully', 201);
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message || err || '');
          const unauth = msg.toLowerCase().includes('unauthenticated') || msg.toLowerCase().includes('401');
          if (unauth && attempt < maxAttempts) {
            console.warn(`[Admin] DAR upload attempt ${attempt}/${maxAttempts} unauthenticated — refreshing token and retrying...`);
            tokenProvider.invalidate('service');
            continue;
          }
          throw err;
        }
      }

      // If we exhausted retries.
      return error(res, `Failed to upload DAR after ${maxAttempts} attempts${lastErr ? `: ${lastErr.message}` : ''}`, 500);
    } finally {
      // Always clean up temp file.
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) { /* ignore */ }
    }
  });
}

module.exports = new AdminController();
