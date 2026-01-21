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
}

module.exports = new HealthController();
