/**
 * Order Validation Schemas
 */

const Joi = require('joi');
const { tradingPairSchema } = require('./common');

const placeOrderSchema = Joi.object({
  body: Joi.object({
    tradingPair: tradingPairSchema.required(),
    orderType: Joi.string().valid('BUY', 'SELL').required(),
    orderMode: Joi.string().valid('LIMIT', 'MARKET').required(),
    price: Joi.when('orderMode', {
      is: 'LIMIT',
      then: Joi.number().positive().required(),
      otherwise: Joi.number().positive().allow(null),
    }),
    quantity: Joi.number().positive().required(),
    partyId: Joi.string().required(),
    orderBookContractId: Joi.string().allow(null, ''),
    userAccountContractId: Joi.string().allow(null, ''),
    allocationCid: Joi.string().allow(null, ''),
  }),
});

const cancelOrderSchema = Joi.object({
  body: Joi.object({
    orderContractId: Joi.string().required(),
    partyId: Joi.string().required(),
    tradingPair: tradingPairSchema.required(),
    orderType: Joi.string().valid('BUY', 'SELL').required(),
    orderBookContractId: Joi.string().allow(null, ''),
    userAccountContractId: Joi.string().allow(null, ''),
  }),
});

module.exports = {
  placeOrderSchema,
  cancelOrderSchema,
};
