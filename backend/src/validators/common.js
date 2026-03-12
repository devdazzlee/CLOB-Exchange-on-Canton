/**
 * Common Validation Schemas
 * Shared validation rules using Joi
 */

const Joi = require('joi');

const tradingPairSchema = Joi.string()
  .pattern(/^[A-Z0-9]+\/[A-Z0-9]+$/)
  .required()
  .messages({
    'string.pattern.base': 'Trading pair must be in format BASE/QUOTE (e.g., BTC/USDT)',
  });

const partyIdSchema = Joi.string().required().min(1);

const contractIdSchema = Joi.string().required().min(1);

const paginationSchema = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

module.exports = {
  tradingPairSchema,
  partyIdSchema,
  contractIdSchema,
  paginationSchema,
};
