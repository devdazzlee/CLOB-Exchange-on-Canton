/**
 * Order Service with UTXO Handling
 * Wraps order operations (placement, cancellation, matching) with UTXO handling
 */

const UTXOHandler = require('./utxo-handler');
const CantonAdmin = require('./canton-admin');
const cantonService = require('./cantonService');
const tradeStore = require('./trade-store');
const { extractTradesFromEvents } = require('./trade-utils');

function recordTradesFromResult(result) {
  const trades = extractTradesFromEvents(result?.events);
  if (trades.length === 0) return [];

  trades.forEach((trade) => {
    tradeStore.addTrade(trade);
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${trade.tradingPair}`, {
        type: 'NEW_TRADE',
        ...trade,
      });
      global.broadcastWebSocket('trades:all', {
        type: 'NEW_TRADE',
        ...trade,
      });
    }
  });

  return trades;
}

function extractLatestUserAccountContractId(events, partyId) {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const created = events[i]?.created;
    if (!created) continue;
    const templateId = created.templateId;
    const templateName = typeof templateId === 'string'
      ? templateId
      : `${templateId?.moduleName || ''}:${templateId?.entityName || ''}`;
    if (!templateName.includes('UserAccount')) continue;
    const args = created.createArguments || created.createArgument || created.argument || {};
    if (!partyId || args.party === partyId) {
      return created.contractId || null;
    }
  }
  return null;
}

async function getLedgerEndOffset(adminToken) {
  const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.offset || null;
    }
  } catch (e) {
    console.warn('[Ledger End] Failed to get ledger end:', e.message);
  }
  return null;
}

async function getActiveAtOffset(adminToken, completionOffset = null) {
  if (completionOffset) {
    return completionOffset.toString();
  }
  const ledgerEnd = await getLedgerEndOffset(adminToken);
  if (ledgerEnd) {
    return ledgerEnd.toString();
  }
  throw new Error('Could not determine activeAtOffset');
}

class OrderService {
  constructor() {
    this.utxoHandler = new UTXOHandler();
    this.cantonAdmin = new CantonAdmin();
  }

  /**
   * Place order with Splice Allocation (optional path)
   * Uses Allocation CID created by frontend (Step A of two-step process)
   */
  async placeOrderWithAllocation(partyId, tradingPair, orderType, orderMode, quantity, price, orderBookContractId, allocationCid) {
    try {
      console.log(`[Order Service] Placing order with Splice Allocation for ${partyId}`);
      console.log(`[Order Service] Allocation CID: ${allocationCid.substring(0, 30)}...`);
      
      // Step 1: Get admin token for Ledger API
      const adminToken = await this.cantonAdmin.getAdminToken();
      await cantonService.ensurePartyRights(partyId, adminToken);
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

      // Step 2: Get OrderBook to find operator and template with retry logic
      const activeAtOffset = await getActiveAtOffset(adminToken);
      let orderBookResponse;
      let orderBookData;
      let retries = 10;
      
      // Retry logic for pending OrderBook contracts
      while (retries > 0) {
        orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            activeAtOffset: activeAtOffset,
            filter: {
              filtersForAnyParty: {
                inclusive: {
                  contractIds: [orderBookContractId]
                }
              }
            }
          })
        });

        if (orderBookResponse.ok) {
          orderBookData = await orderBookResponse.json();
          if (orderBookData.activeContracts && orderBookData.activeContracts.length > 0) {
            // OrderBook found, break the retry loop
            break;
          }
        }
        
        // If not found or not ok, wait and retry
        if (retries > 1) {
          console.log(`[Order Service] OrderBook not yet visible (Allocation), retrying in 1 second... (${11 - retries}/10)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        retries--;
      }

      if (!orderBookResponse.ok || !orderBookData?.activeContracts?.length) {
        throw new Error('Failed to fetch OrderBook after retries');
      }
      const orderBook = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent || 
                       orderBookData.activeContracts?.[0]?.createdEvent ||
                       orderBookData.activeContracts?.[0];
      
      const operator = orderBook?.createArgument?.operator || orderBook?.argument?.operator;
      if (!operator) {
        throw new Error('OrderBook operator not found');
      }

      // Step 3: Place order via AddOrder choice with Allocation CID
      const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const orderBookTemplateId = orderBook?.templateId || 'MasterOrderBook:MasterOrderBook';
      const readAsParties = operator && operator !== partyId ? [partyId, operator] : [partyId];

      // Build AddOrder argument with Allocation CID
      const addOrderArgument = {
        orderId: orderId,
        owner: partyId,
        orderType: orderType,
        orderMode: orderMode,
        price: orderMode === 'LIMIT' && price ? price.toString() : null,
        quantity: quantity.toString(),
        allocationCid: allocationCid // CRITICAL: Pass Allocation CID for Splice model
      };

      console.log('[Order Service] Exercising AddOrder with Allocation:', {
        orderId,
        allocationCid: allocationCid.substring(0, 30) + '...',
        orderType,
        quantity
      });

      const exerciseResponse = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: partyId,
        templateId: orderBookTemplateId,
        contractId: orderBookContractId,
        choice: 'AddOrder',
        choiceArgument: addOrderArgument,
        readAs: readAsParties,
      });

      const result = exerciseResponse; // exerciseChoice returns the result directly

      console.log(`[Order Service] ✅ Order placed successfully with Allocation. Update ID: ${result.updateId}`);

      // Extract order contract ID if available in response
      let orderContractId = null;
      if (result.events && Array.isArray(result.events)) {
        for (const event of result.events) {
          if (event.created?.contractId && event.created?.templateId?.includes('Order')) {
            orderContractId = event.created.contractId;
            console.log(`[Order Service] ✅ Order contract ID from response: ${orderContractId.substring(0, 50)}...`);
            break;
          }
        }
      }

      const recordedTrades = recordTradesFromResult(result);
      const tradesCreated = recordedTrades.length;
      if (tradesCreated > 0) {
        console.log(`[Order Service] ✅ Matchmaking executed! ${tradesCreated} trade(s) created`);
      }

      const userAccountContractId = extractLatestUserAccountContractId(result.events, partyId);

      return {
        success: true,
        orderId: orderId,
        orderContractId: orderContractId,
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        allocationUsed: allocationCid,
        userAccountContractId: userAccountContractId,
        tradesCreated: tradesCreated,
        matchmakingExecuted: tradesCreated > 0
      };
    } catch (error) {
      console.error('[Order Service] Error placing order with Allocation:', error);
      throw error;
    }
  }

  /**
   * Place order with UserAccount/UTXO handling
   * 1. Check balance and merge UTXOs if needed
   * 2. Place order via Ledger API
   * 3. Return result
   */
  async placeOrderWithUTXOHandling(partyId, tradingPair, orderType, orderMode, quantity, price, orderBookContractId, userAccountContractIdParam) {
    try {
      console.log(`[Order Service] Placing order with UTXO handling for ${partyId}`);
      
      // Ensure userAccountContractId is defined (handle undefined from missing request body field)
      const userAccountContractIdSafe = userAccountContractIdParam || null;
      
      // Step 1: Pre-order UTXO handling
      const preOrderResult = await this.utxoHandler.handlePreOrderPlacement(
        partyId,
        tradingPair,
        orderType,
        parseFloat(quantity),
        price ? parseFloat(price) : null,
        userAccountContractIdSafe // Pass contract ID if available
      );

      if (!preOrderResult.success) {
        throw new Error(preOrderResult.error || 'Insufficient balance or UTXO issue');
      }

      console.log(`[Order Service] ✅ UTXO check passed. Balance: ${preOrderResult.totalBalance}, Merged: ${preOrderResult.merged}`);

      // Step 2: Get admin token for Ledger API
      const adminToken = await this.cantonAdmin.getAdminToken();
      await cantonService.ensurePartyRights(partyId, adminToken);
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

      // Step 3: Get OrderBook to find operator with retry logic for pending contracts
      const activeAtOffset = await getActiveAtOffset(adminToken);
      let orderBookResponse;
      let orderBookData;
      let retries = 10;
      
      // Retry logic for pending OrderBook contracts
      while (retries > 0) {
        orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            activeAtOffset: activeAtOffset,
            filter: {
              filtersForAnyParty: {
                inclusive: {
                  contractIds: [orderBookContractId]
                }
              }
            }
          })
        });

        if (orderBookResponse.ok) {
          orderBookData = await orderBookResponse.json();
          if (orderBookData.activeContracts && orderBookData.activeContracts.length > 0) {
            // OrderBook found, break the retry loop
            break;
          }
        }
        
        // If not found or not ok, wait and retry
        if (retries > 1) {
          console.log(`[Order Service] OrderBook not yet visible, retrying in 1 second... (${11 - retries}/10)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        retries--;
      }

      if (!orderBookResponse.ok || !orderBookData?.activeContracts?.length) {
        throw new Error('Failed to fetch OrderBook after retries');
      }
      const orderBook = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent || 
                       orderBookData.activeContracts?.[0]?.createdEvent ||
                       orderBookData.activeContracts?.[0];
      
      const operator = orderBook?.createArgument?.operator || orderBook?.argument?.operator;
      if (!operator) {
        throw new Error('OrderBook operator not found');
      }

      // Step 4: Place order via AddOrder choice
      const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const orderBookTemplateId = orderBook?.templateId || 'OrderBook:OrderBook';
      const readAsParties = operator && operator !== partyId ? [partyId, operator] : [partyId];

      const exerciseResponse = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: partyId,
        templateId: orderBookTemplateId,
        contractId: orderBookContractId,
        choice: 'AddOrder',
        choiceArgument: {
          orderId: orderId,
          owner: partyId,
          orderType: orderType,
          orderMode: orderMode,
          price: orderMode === 'LIMIT' && price ? price.toString() : null,
          quantity: quantity.toString()
        },
        readAs: readAsParties,
      });

      const result = exerciseResponse; // exerciseChoice returns the result directly

      console.log(`[Order Service] ✅ Order placed successfully. Update ID: ${result.updateId}`);
      console.log(`[Order Service] Matchmaking should have executed automatically (MatchOrders called in AddOrder)`);

      // Extract order contract ID if available in response
      let orderContractId = null;
      if (result.events && Array.isArray(result.events)) {
        for (const event of result.events) {
          if (event.created?.contractId && event.created?.templateId?.includes('Order')) {
            orderContractId = event.created.contractId;
            console.log(`[Order Service] ✅ Order contract ID from response: ${orderContractId.substring(0, 50)}...`);
            break;
          }
        }
      }

      const recordedTrades = recordTradesFromResult(result);
      const tradesCreated = recordedTrades.length;
      if (tradesCreated > 0) {
        console.log(`[Order Service] ✅ Matchmaking executed! ${tradesCreated} trade(s) created`);
      }

      const updatedUserAccountId = extractLatestUserAccountContractId(result.events, partyId);
      const userAccountContractId = updatedUserAccountId || preOrderResult.userAccount?.contractId || null;

      return {
        success: true,
        orderId: orderId,
        orderContractId: orderContractId,
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        utxoHandled: preOrderResult.merged,
        userAccount: preOrderResult.userAccount,
        userAccountContractId: userAccountContractId,
        tradesCreated: tradesCreated,
        matchmakingExecuted: tradesCreated > 0
      };
    } catch (error) {
      console.error('[Order Service] Error placing order:', error);
      throw error;
    }
  }

  /**
   * Cancel order with UTXO handling
   * 1. Cancel order via Ledger API
   * 2. Remove from OrderBook
   * 3. Merge UTXOs after cancellation
   */
  async cancelOrderWithUTXOHandling(partyId, tradingPair, orderType, orderContractId, orderBookContractId, userAccountContractIdParam) {
    try {
      console.log(`[Order Service] Cancelling order with UTXO handling for ${partyId}`);

      // Ensure userAccountContractId is defined (handle undefined from missing request body field)
      const userAccountContractIdSafe = userAccountContractIdParam || null;

      const adminToken = await this.cantonAdmin.getAdminToken();
      await cantonService.ensurePartyRights(partyId, adminToken);
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

      // Step 1: Get order details
      const orderResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: await getActiveAtOffset(adminToken),
          filter: {
            filtersForAnyParty: {
              inclusive: {
                contractIds: [orderContractId]
              }
            }
          }
        })
      });

      if (!orderResponse.ok) {
        throw new Error('Failed to fetch order');
      }

      const orderData = await orderResponse.json();
      const order = orderData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent || 
                   orderData.activeContracts?.[0]?.createdEvent ||
                   orderData.activeContracts?.[0];

      if (!order) {
        throw new Error('Order not found');
      }

      const orderTemplateId = order?.templateId || 'Order:Order';

      // Step 2: Cancel order
      const cancelCommandId = `cancel-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const cancelResult = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: partyId,
        templateId: orderTemplateId,
        contractId: orderContractId,
        choice: 'CancelOrder',
        choiceArgument: {},
        readAs: [partyId],
      });

      console.log(`[Order Service] ✅ Order cancelled. Update ID: ${cancelResult.updateId}`);

      // Step 3: Remove from OrderBook (if orderBookContractId provided)
      if (orderBookContractId) {
        try {
          const orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
              activeAtOffset: "0",
              filter: {
                filtersForAnyParty: {
                  inclusive: {
                    contractIds: [orderBookContractId]
                  }
                }
              }
            })
          });

          if (orderBookResponse.ok) {
            const orderBookData = await orderBookResponse.json();
            const orderBook = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent || 
                           orderBookData.activeContracts?.[0]?.createdEvent ||
                           orderBookData.activeContracts?.[0];
            
            const operator = orderBook?.createArgument?.operator || orderBook?.argument?.operator;
            const orderBookTemplateId = orderBook?.templateId || 'OrderBook:OrderBook';

            if (operator) {
              const removeCommandId = `remove-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              
              await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                  commandId: removeCommandId,
                  commands: [{
                    exercise: {
                      templateId: orderBookTemplateId,
                      contractId: orderBookContractId,
                      choice: 'RemoveOrder',
                      argument: {
                        orderCid: orderContractId
                      }
                    }
                  }],
                  actAs: [operator]
                })
              });
              
              console.log(`[Order Service] ✅ Order removed from OrderBook`);
            }
          }
        } catch (removeError) {
          console.warn('[Order Service] Failed to remove order from OrderBook (non-critical):', removeError.message);
        }
      }

      // Step 4: Post-cancellation UTXO merge
      if (userAccountContractIdSafe) {
        const postCancelResult = await this.utxoHandler.handlePostCancellation(
          partyId,
          tradingPair,
          orderType,
          userAccountContractIdSafe
        );

        console.log(`[Order Service] ✅ Post-cancellation UTXO merge: ${postCancelResult.success ? 'success' : 'failed'}`);
      }

      return {
        success: true,
        updateId: cancelResult.updateId,
        completionOffset: cancelResult.completionOffset,
        utxoMerged: true
      };
    } catch (error) {
      console.error('[Order Service] Error cancelling order:', error);
      throw error;
    }
  }

  /**
   * Handle matchmaking with UTXO handling
   * This is called after orders are matched to merge UTXOs for partial fills
   */
  async handleMatchmakingWithUTXO(buyerPartyId, sellerPartyId, tradingPair, buyOrderType, sellOrderType, 
                                  buyRemainingQuantity, sellRemainingQuantity, buyerUserAccountId, sellerUserAccountId) {
    try {
      console.log(`[Order Service] Handling matchmaking UTXO merge`);

      // Merge UTXOs for both parties after partial fills
      const [baseToken, quoteToken] = tradingPair.split('/');

      // Buyer: merge quote token UTXOs (if partial fill, remaining quote token needs merging)
      if (buyerUserAccountId && buyRemainingQuantity > 0) {
        try {
          await this.utxoHandler.handlePostPartialFill(
            buyerPartyId,
            tradingPair,
            buyOrderType,
            buyRemainingQuantity,
            buyerUserAccountId
          );
        } catch (error) {
          console.warn('[Order Service] Buyer UTXO merge failed (non-critical):', error.message);
        }
      }

      // Seller: merge base token UTXOs (if partial fill, remaining base token needs merging)
      if (sellerUserAccountId && sellRemainingQuantity > 0) {
        try {
          await this.utxoHandler.handlePostPartialFill(
            sellerPartyId,
            tradingPair,
            sellOrderType,
            sellRemainingQuantity,
            sellerUserAccountId
          );
        } catch (error) {
          console.warn('[Order Service] Seller UTXO merge failed (non-critical):', error.message);
        }
      }

      return {
        success: true,
        buyerUTXOMerged: !!buyerUserAccountId,
        sellerUTXOMerged: !!sellerUserAccountId
      };
    } catch (error) {
      console.error('[Order Service] Error in matchmaking UTXO handling:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = OrderService;

