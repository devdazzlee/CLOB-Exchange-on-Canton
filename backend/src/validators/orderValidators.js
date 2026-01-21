/**
 * Order Validation Schemas
 */

const Joi = require('joi');
const { tradingPairSchema } = require('./common');

const placeOrderSchema = Joi.object({
  body: Joi.object({
    side: Joi.string().valid('BUY', 'SELL').required(),
    orderType: Joi.string().valid('LIMIT', 'MARKET').required(),
    price: Joi.when('orderType', {
      is: 'LIMIT',
      then: Joi.number().positive().required(),
      otherwise: Joi.number().positive().allow(null),
    }),
    quantity: Joi.number().positive().required(),
    partyId: Joi.string().required(),
  }),
  params: Joi.object({
    tradingPair: tradingPairSchema.optional(),
  }),
});

const cancelOrderSchema = Joi.object({
  body: Joi.object({
    orderContractId: Joi.string().required(),
    partyId: Joi.string().required(),
    tradingPair: tradingPairSchema,
  }),
});

module.exports = {
  placeOrderSchema,
  cancelOrderSchema,
};
