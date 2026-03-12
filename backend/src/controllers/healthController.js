/**
 * Health Controller
 * Handles health check endpoints
 */

const { success } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class HealthController {
  /**
   * Health check
   */
  check = asyncHandler(async (req, res) => {
    return success(res, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }, 'Service is healthy');
  });

  /**
   * WebSocket status
   */
  wsStatus = asyncHandler(async (req, res) => {
    const clients = global.wsClients || new Map();
    const channels = new Set();
    
    clients.forEach((client) => {
      if (client.subscriptions) {
        client.subscriptions.forEach((channel) => channels.add(channel));
      }
    });

    return success(res, {
      connected: clients.size,
      channels: Array.from(channels),
    }, 'WebSocket status retrieved');
  });

  /**
   * Streaming read model stats — monitor the WebSocket-backed in-memory state
   */
  streamingStats = asyncHandler(async (req, res) => {
    let streamingStats = { ready: false, mode: 'not-initialized' };
    let readModelStats = null;

    try {
      const { getStreamingReadModel } = require('../services/streamingReadModel');
      const streaming = getStreamingReadModel();
      if (streaming) {
        streamingStats = streaming.getStats();
      }
    } catch (_) { /* not available */ }

    try {
      const { getReadModelService } = require('../services/readModelService');
      const readModel = getReadModelService();
      if (readModel) {
        readModelStats = readModel.getStreamingStats();
      }
    } catch (_) { /* not available */ }

    const wsClients = global.wsClients || new Map();

    return success(res, {
      streaming: streamingStats,
      readModel: readModelStats,
      websocket: {
        connectedClients: wsClients.size,
      },
      timestamp: new Date().toISOString(),
    }, 'Streaming stats retrieved');
  });
}

module.exports = new HealthController();
