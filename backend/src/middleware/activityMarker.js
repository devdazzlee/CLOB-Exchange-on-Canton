/**
 * Activity Marker Middleware
 * Milestone 4: Activity markers for Canton tracking
 * 
 * Adds activity markers to requests/responses for tracking and monitoring
 */

/**
 * Generate activity marker for a request
 * Format: timestamp:service:operation:partyId:requestId
 */
function generateActivityMarker(req, operation) {
  const timestamp = Date.now();
  const service = 'clob-exchange-backend';
  const partyId = req.partyId || req.walletId || 'anonymous';
  const requestId = req.requestId || req.id || 'unknown';

  return `${timestamp}:${service}:${operation}:${partyId}:${requestId}`;
}

/**
 * Activity marker middleware
 * Adds activity markers to request and response
 */
function activityMarkerMiddleware(req, res, next) {
  // Generate request marker
  const requestMarker = generateActivityMarker(req, req.method.toLowerCase() + ':' + req.path);
  req.activityMarker = requestMarker;

  // Add marker to request headers (for downstream services)
  req.headers['x-activity-marker'] = requestMarker;

  // Log activity marker
  console.log(`[ActivityMarker] ${requestMarker}`);

  // Set response headers BEFORE response is sent
  // Use res.once('finish') to log after response, but set headers immediately
  const responseMarker = generateActivityMarker(req, 'response:' + req.path);
  
  // Set headers immediately (before response is sent)
  try {
    if (!res.headersSent) {
      res.setHeader('x-activity-marker', responseMarker);
      res.setHeader('x-request-marker', requestMarker);
    }
  } catch (error) {
    // Headers already sent - ignore (shouldn't happen but be safe)
    console.warn('[ActivityMarker] Could not set response headers:', error.message);
  }

  // Log response marker after response completes (for monitoring)
  res.once('finish', () => {
    console.log(`[ActivityMarker] Response: ${responseMarker}`);
  });

  next();
}

/**
 * Add activity marker to Canton API calls
 */
function addCantonActivityMarker(requestData, operation) {
  const marker = {
    timestamp: Date.now(),
    service: 'clob-exchange',
    operation,
    source: 'backend'
  };

  // Add to request metadata
  if (!requestData.metadata) {
    requestData.metadata = {};
  }
  requestData.metadata.activityMarker = marker;

  return marker;
}

/**
 * Extract activity marker from Canton response
 */
function extractCantonActivityMarker(response) {
  const marker = response?.metadata?.activityMarker || response?.headers?.['x-activity-marker'];
  return marker;
}

module.exports = {
  activityMarkerMiddleware,
  generateActivityMarker,
  addCantonActivityMarker,
  extractCantonActivityMarker
};
