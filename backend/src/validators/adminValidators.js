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
    // Accept either:
    // - darFile: base64-encoded DAR contents (current API)
    // - darPath: server-side filesystem path to the DAR (useful for scripts)
    darFile: Joi.string().base64(),
    darPath: Joi.string(),
  })
    .xor('darFile', 'darPath')
    .required(),
}).required();

module.exports = {
  createOrderBookSchema,
  uploadDarSchema,
};
