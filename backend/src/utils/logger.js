/**
 * Logger Utility
 * 
 * Centralized logging with winston:
 * - Console output (colorized for dev)
 * - File output: logs/combined.log (all levels)
 * - File output: logs/error.log (errors only)
 * - Daily rotation to prevent unbounded growth
 * 
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Server started');
 *   logger.error('Something failed', { detail: err.message });
 *   logger.warn('Deprecation notice');
 *   logger.debug('Verbose info');
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ── Custom format for log files (structured, timestamped) ──
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}`;
    if (stack) {
      log += `\n${stack}`;
    }
    if (Object.keys(meta).length > 0) {
      log += `  ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// ── Custom format for console (colorized, same structure) ──
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] ${level}: ${message}`;
    if (stack) {
      log += `\n${stack}`;
    }
    if (Object.keys(meta).length > 0) {
      log += `  ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// ── Create the logger ──
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'clob-exchange' },
  transports: [
    // ── Console transport (always active) ──
    new winston.transports.Console({
      format: consoleFormat,
      // In production, only info+
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),

    // ── Combined log file (all levels) ──
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'combined.log'),
      format: fileFormat,
      level: 'debug',
      maxsize: 10 * 1024 * 1024, // 10 MB per file
      maxFiles: 5,                // Keep 5 rotated files
      tailable: true,
    }),

    // ── Error log file (error level only) ──
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      format: fileFormat,
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],

  // Don't exit on uncaught errors in transports
  exitOnError: false,
});

// ── Override console methods to funnel ALL output through winston ──
// This captures logs from 3rd-party libs and existing console.log calls
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

console.log = (...args) => {
  logger.info(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
};
console.info = (...args) => {
  logger.info(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
};
console.warn = (...args) => {
  logger.warn(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
};
console.error = (...args) => {
  logger.error(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
};
console.debug = (...args) => {
  logger.debug(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
};

// ── Express request logging middleware ──
logger.requestMiddleware = (req, res, next) => {
  const start = Date.now();
  const { method, path: reqPath, ip } = req;

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${method} ${reqPath} ${statusCode} ${duration}ms`, {
      ip: ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']?.substring(0, 80),
      statusCode,
      duration,
    });
  });

  next();
};

// ── Expose the original console (useful if a lib truly needs raw stdout) ──
logger.originalConsole = originalConsole;

// ── Log the logger itself being initialized ──
logger.info(`Logger initialized — logs directory: ${LOGS_DIR}`);
logger.info(`Log level: ${logger.level}`);

module.exports = logger;
