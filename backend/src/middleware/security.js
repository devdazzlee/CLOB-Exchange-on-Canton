/**
 * Security Hardening Middleware
 * Milestone 4: Security pass - rate limits, audit logs, key handling
 */

let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (err) {
  console.warn('[Security] express-rate-limit not installed, rate limiting disabled');
  rateLimit = null;
}

/**
 * Rate limiting for API endpoints
 */
const apiLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
}) : (req, res, next) => next(); // No-op if rate limiting not available

/**
 * Stricter rate limiting for wallet operations
 */
const walletLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 wallet operations per windowMs
  message: 'Too many wallet operations from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
}) : (req, res, next) => next(); // No-op if rate limiting not available

/**
 * Rate limiting for order placement
 */
const orderLimiter = rateLimit ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 orders per minute
  message: 'Too many orders from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
}) : (req, res, next) => next(); // No-op if rate limiting not available

/**
 * Audit log middleware
 * Logs all sensitive operations for security review
 */
function auditLogMiddleware(req, res, next) {
  const sensitivePaths = [
    '/api/v1/wallets',
    '/api/v1/orders',
    '/api/balance',
    '/api/v1/auth'
  ];

  const isSensitive = sensitivePaths.some(path => req.path.startsWith(path));

  if (isSensitive) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      partyId: req.partyId || req.walletId || 'anonymous',
      requestId: req.requestId || req.id || 'unknown'
    };

    // Log to console (in production, this should go to a secure audit log)
    console.log('[AUDIT]', JSON.stringify(auditEntry));

    // Add to response for tracking
    res.locals.auditEntry = auditEntry;
  }

  next();
}

/**
 * Security headers middleware
 */
function securityHeadersMiddleware(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Strict transport security (if using HTTPS)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Content security policy
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  
  next();
}

/**
 * Validate and sanitize party ID
 * Prevents injection attacks via party ID
 */
function validatePartyId(partyId) {
  if (!partyId || typeof partyId !== 'string') {
    return false;
  }

  // Party ID format: partyHint::fingerprint
  // Allow alphanumeric, colons, hyphens, underscores
  const partyIdPattern = /^[a-zA-Z0-9_-]+::[a-zA-Z0-9_-]+$/;
  return partyIdPattern.test(partyId);
}

/**
 * Validate trading pair format
 */
function validateTradingPair(tradingPair) {
  if (!tradingPair || typeof tradingPair !== 'string') {
    return false;
  }

  // Trading pair format: BASE/QUOTE (e.g., BTC/USDT)
  const tradingPairPattern = /^[A-Z0-9]+\/[A-Z0-9]+$/;
  return tradingPairPattern.test(tradingPair);
}

/**
 * Sanitize input to prevent injection
 */
function sanitizeInput(input) {
  if (typeof input === 'string') {
    // Remove potentially dangerous characters
    return input.replace(/[<>\"']/g, '');
  }
  return input;
}

module.exports = {
  apiLimiter,
  walletLimiter,
  orderLimiter,
  auditLogMiddleware,
  securityHeadersMiddleware,
  validatePartyId,
  validateTradingPair,
  sanitizeInput
};
