/**
 * Request Validation Middleware
 * Validates request body, params, and query
 */

const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(
      {
        body: req.body,
        params: req.params,
        query: req.query,
      },
      { abortEarly: false, stripUnknown: true }
    );

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors,
      });
    }

    // Replace request data with validated values
    req.body = value.body;
    req.params = value.params;
    req.query = value.query;

    next();
  };
};

module.exports = validate;
