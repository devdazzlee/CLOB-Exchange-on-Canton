/**
 * Ledger Error Utilities
 * 
 * Standardized error handling for Canton JSON Ledger API interactions.
 * Maps Canton's JsCantonError to consistent Exchange API error responses.
 */

/**
 * Error codes for Exchange API
 */
const ErrorCodes = {
    // Ledger errors
    LEDGER_COMMAND_REJECTED: 'LEDGER_COMMAND_REJECTED',
    LEDGER_UNAVAILABLE: 'LEDGER_UNAVAILABLE',
    LEDGER_TIMEOUT: 'LEDGER_TIMEOUT',

    // Business errors
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
    INVALID_ORDER: 'INVALID_ORDER',
    ORDER_ALREADY_CANCELLED: 'ORDER_ALREADY_CANCELLED',
    ORDER_ALREADY_FILLED: 'ORDER_ALREADY_FILLED',

    // Auth errors
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',

    // Validation errors
    INVALID_REQUEST: 'INVALID_REQUEST',
    VALIDATION_ERROR: 'VALIDATION_ERROR',

    // System errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
};

/**
 * LedgerError - Standardized error for ledger operations
 */
class LedgerError extends Error {
    /**
     * @param {string} code - Error code from ErrorCodes
     * @param {string} message - Human-readable error message
     * @param {Object} canton - Canton error details (optional)
     */
    constructor(code, message, canton = null) {
        super(message);
        this.name = 'LedgerError';
        this.code = code;
        this.canton = canton;
        this.timestamp = new Date().toISOString();
    }

    /**
     * Convert to JSON for API response
     */
    toJSON() {
        return {
            ok: false,
            error: {
                code: this.code,
                message: this.message,
                ...(this.canton && { canton: this.canton })
            }
        };
    }

    /**
     * Get HTTP status code for this error
     */
    getHttpStatus() {
        switch (this.code) {
            case ErrorCodes.UNAUTHORIZED:
                return 401;
            case ErrorCodes.FORBIDDEN:
                return 403;
            case ErrorCodes.ORDER_NOT_FOUND:
                return 404;
            case ErrorCodes.INVALID_REQUEST:
            case ErrorCodes.VALIDATION_ERROR:
            case ErrorCodes.INVALID_ORDER:
            case ErrorCodes.INSUFFICIENT_BALANCE:
            case ErrorCodes.ORDER_ALREADY_CANCELLED:
            case ErrorCodes.ORDER_ALREADY_FILLED:
                return 400;
            case ErrorCodes.LEDGER_COMMAND_REJECTED:
                return 400;
            case ErrorCodes.LEDGER_UNAVAILABLE:
            case ErrorCodes.SERVICE_UNAVAILABLE:
                return 503;
            case ErrorCodes.LEDGER_TIMEOUT:
                return 504;
            default:
                return 500;
        }
    }
}

/**
 * ValidationError - For request validation failures
 */
class ValidationError extends LedgerError {
    constructor(message, details = null) {
        super(ErrorCodes.VALIDATION_ERROR, message, null);
        this.details = details;
    }

    toJSON() {
        return {
            ok: false,
            error: {
                code: this.code,
                message: this.message,
                ...(this.details && { details: this.details })
            }
        };
    }
}

/**
 * NotFoundError - For resources that don't exist
 */
class NotFoundError extends LedgerError {
    constructor(resource, id) {
        super(ErrorCodes.ORDER_NOT_FOUND, `${resource} not found: ${id}`);
        this.resource = resource;
        this.resourceId = id;
    }
}

/**
 * Extract Canton error details from API response
 * 
 * @param {Error|Object} error - Error from Canton API
 * @returns {Object|null} - Extracted Canton error details
 */
function extractCantonError(error) {
    // Handle fetch response errors
    if (error.response?.data) {
        const data = error.response.data;
        return {
            code: data.code || null,
            cause: data.cause || data.message || null,
            correlationId: data.correlationId || null,
            traceId: data.traceId || null,
            context: data.context || null,
            errorCategory: data.errorCategory || null
        };
    }

    // Handle parsed error body
    if (error.code && (error.correlationId || error.traceId)) {
        return {
            code: error.code,
            cause: error.cause || error.message,
            correlationId: error.correlationId,
            traceId: error.traceId,
            context: error.context,
            errorCategory: error.errorCategory
        };
    }

    // Handle string error messages that might contain Canton error info
    if (typeof error.message === 'string') {
        // Try to parse JSON from error message
        try {
            const match = error.message.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                if (parsed.code) {
                    return {
                        code: parsed.code,
                        cause: parsed.cause || parsed.message,
                        correlationId: parsed.correlationId,
                        traceId: parsed.traceId
                    };
                }
            }
        } catch (e) {
            // Not parseable, ignore
        }
    }

    return null;
}

/**
 * Create LedgerError from Canton API response
 * 
 * @param {Response} response - Fetch response object
 * @param {string} operation - Name of the operation that failed
 * @returns {Promise<LedgerError>}
 */
async function createLedgerErrorFromResponse(response, operation) {
    let errorData;
    let errorText;

    try {
        errorText = await response.text();
        errorData = JSON.parse(errorText);
    } catch (e) {
        errorData = { message: errorText || 'Unknown error' };
    }

    const cantonError = extractCantonError(errorData);

    // Map Canton error codes to Exchange error codes
    let code = ErrorCodes.LEDGER_COMMAND_REJECTED;
    let message = errorData.cause || errorData.message || `${operation} failed`;

    if (response.status === 401) {
        code = ErrorCodes.UNAUTHORIZED;
        message = 'Authentication required or token expired';
    } else if (response.status === 403) {
        code = ErrorCodes.FORBIDDEN;
        message = 'Access denied';
    } else if (response.status === 404) {
        code = ErrorCodes.ORDER_NOT_FOUND;
    } else if (response.status >= 500) {
        code = ErrorCodes.LEDGER_UNAVAILABLE;
        message = 'Ledger service unavailable';
    }

    // Check for specific Canton error codes
    if (cantonError?.code) {
        if (cantonError.code.includes('INSUFFICIENT_FUNDS') ||
            cantonError.code.includes('INSUFFICIENT_BALANCE')) {
            code = ErrorCodes.INSUFFICIENT_BALANCE;
        } else if (cantonError.code.includes('NOT_FOUND') ||
            cantonError.code.includes('CONTRACT_NOT_ACTIVE')) {
            code = ErrorCodes.ORDER_NOT_FOUND;
        } else if (cantonError.code.includes('PACKAGE_SELECTION_FAILED')) {
            message = `Package vetting error: ${cantonError.cause}. ` +
                'Ensure the DAR is uploaded and vetted on all participants.';
        }
    }

    return new LedgerError(code, message, cantonError);
}

/**
 * Wrap an async function with standardized error handling
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Wrapped function
 */
function withErrorHandling(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            if (error instanceof LedgerError) {
                return res.status(error.getHttpStatus()).json({
                    ...error.toJSON(),
                    meta: { requestId: req.requestId || 'unknown' }
                });
            }

            // Unexpected error
            console.error('[LedgerError] Unexpected error:', error);
            return res.status(500).json({
                ok: false,
                error: {
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: 'An unexpected error occurred'
                },
                meta: { requestId: req.requestId || 'unknown' }
            });
        }
    };
}

module.exports = {
    ErrorCodes,
    LedgerError,
    ValidationError,
    NotFoundError,
    extractCantonError,
    createLedgerErrorFromResponse,
    withErrorHandling
};
