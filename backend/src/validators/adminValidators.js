/**
 * Admin Validation Schemas
 */

const Joi = require('joi');
const { tradingPairSchema } = require('./common');

const createOrderBookSchema = Joi.object({
  params: Joi.object({
    tradingPair: tradingPairSchema,
  }),
});

const uploadDarSchema = Joi.object({
  body: Joi.object({
    darFile: Joi.string().base64().required(),
  }),
});

module.exports = {
  createOrderBookSchema,
  uploadDarSchema,
};
