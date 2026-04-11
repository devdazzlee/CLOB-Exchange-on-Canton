/**
 * Helpers to extract Trade data from Canton JSON API events.
 */

function normalizeTemplateId(templateId) {
  if (!templateId) return '';
  if (typeof templateId === 'string') return templateId;
  const moduleName = templateId.moduleName || templateId.module || '';
  const entityName = templateId.entityName || templateId.entity || '';
  return `${moduleName}:${entityName}`;
}

function isTradeTemplate(templateId) {
  const normalized = normalizeTemplateId(templateId);
  if (!normalized) return false;
  if (normalized.includes('Trade')) return true;
  const parts = normalized.split(':');
  return parts[parts.length - 1] === 'Trade';
}

function extractTradeFromCreated(created) {
  if (!created) return null;
  if (!isTradeTemplate(created.templateId)) return null;

  const args = created.createArguments || created.createArgument || created.argument || {};
  const tradingPair = args.tradingPair || args.marketId;
  const tradeId = args.tradeId || created.contractId;

  if (!tradeId || !tradingPair) return null;

  return {
    tradeId,
    contractId: created.contractId,
    tradingPair,
    buyer: args.buyer,
    seller: args.seller,
    price: args.price,
    quantity: args.quantity,
    timestamp: args.timestamp,
    buyOrderId: args.buyOrderId || args.buyOrderCid,
    sellOrderId: args.sellOrderId || args.sellOrderCid,
  };
}

function extractTradesFromEvents(events) {
  if (!Array.isArray(events)) return [];
  const trades = [];
  for (const event of events) {
    const created = event?.created || event?.createdEvent || event;
    const trade = extractTradeFromCreated(created);
    if (trade) trades.push(trade);
  }
  return trades;
}

module.exports = {
  extractTradesFromEvents,
};
