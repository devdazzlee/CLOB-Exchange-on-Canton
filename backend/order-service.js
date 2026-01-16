/**
 * Order Service with UTXO Handling
 * Wraps order operations (placement, cancellation, matching) with UTXO handling
 */

const UTXOHandler = require('./utxo-handler');
const CantonAdmin = require('./canton-admin');

class OrderService {
  constructor() {
    this.utxoHandler = new UTXOHandler();
    this.cantonAdmin = new CantonAdmin();
  }

  /**
   * Place order with UTXO handling
   * 1. Check balance and merge UTXOs if needed
   * 2. Place order via Ledger API
   * 3. Return result
   */
  async placeOrderWithUTXOHandling(partyId, tradingPair, orderType, orderMode, quantity, price, orderBookContractId, userAccountContractId) {
    try {
      console.log(`[Order Service] Placing order with UTXO handling for ${partyId}`);
      
      // Step 1: Pre-order UTXO handling
      const preOrderResult = await this.utxoHandler.handlePreOrderPlacement(
        partyId,
        tradingPair,
        orderType,
        parseFloat(quantity),
        price ? parseFloat(price) : null
      );

      if (!preOrderResult.success) {
        throw new Error(preOrderResult.error || preOrderResult.reason || 'Insufficient balance or UTXO issue');
      }

      console.log(`[Order Service] ✅ UTXO check passed. Balance: ${preOrderResult.totalBalance}, Merged: ${preOrderResult.merged}`);

      // Step 2: Get admin token for Ledger API
      const adminToken = await this.cantonAdmin.getAdminToken();
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

      // Step 3: Get OrderBook to find operator
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

      if (!orderBookResponse.ok) {
        throw new Error('Failed to fetch OrderBook');
      }

      const orderBookData = await orderBookResponse.json();
      const orderBook = orderBookData.activeContracts?.[0]?.contractEntry?.JsActiveContract?.createdEvent || 
                       orderBookData.activeContracts?.[0]?.createdEvent ||
                       orderBookData.activeContracts?.[0];
      
      const operator = orderBook?.createArgument?.operator || orderBook?.argument?.operator;
      if (!operator) {
        throw new Error('OrderBook operator not found');
      }

      // Step 4: Place order via AddOrder choice
      const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const commandId = `place-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const orderBookTemplateId = orderBook?.templateId || 'OrderBook:OrderBook';
      
      // Determine actAs parties
      const actAsParties = [partyId];
      if (operator && operator !== partyId) {
        actAsParties.push(operator);
      }

      const exerciseResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          commandId: commandId,
          commands: [{
            exercise: {
              templateId: orderBookTemplateId,
              contractId: orderBookContractId,
              choice: 'AddOrder',
              argument: {
                orderId: orderId,
                owner: partyId,
                orderType: orderType,
                orderMode: orderMode,
                price: orderMode === 'LIMIT' && price ? price.toString() : null,
                quantity: quantity.toString()
              }
            }
          }],
          actAs: actAsParties
        })
      });

      if (!exerciseResponse.ok) {
        const errorText = await exerciseResponse.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: errorText };
        }
        throw new Error(error.message || error.cause || `Failed to place order: ${exerciseResponse.statusText}`);
      }

      const result = await exerciseResponse.json();

      console.log(`[Order Service] ✅ Order placed successfully. Update ID: ${result.updateId}`);

      return {
        success: true,
        orderId: orderId,
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        utxoHandled: preOrderResult.merged,
        userAccount: preOrderResult.userAccount
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
  async cancelOrderWithUTXOHandling(partyId, tradingPair, orderType, orderContractId, orderBookContractId, userAccountContractId) {
    try {
      console.log(`[Order Service] Cancelling order with UTXO handling for ${partyId}`);

      const adminToken = await this.cantonAdmin.getAdminToken();
      const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';

      // Step 1: Get order details
      const orderResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
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
      
      const cancelResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          commandId: cancelCommandId,
          commands: [{
            exercise: {
              templateId: orderTemplateId,
              contractId: orderContractId,
              choice: 'CancelOrder',
              argument: {}
            }
          }],
          actAs: [partyId]
        })
      });

      if (!cancelResponse.ok) {
        const errorText = await cancelResponse.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: errorText };
        }
        throw new Error(error.message || error.cause || `Failed to cancel order: ${cancelResponse.statusText}`);
      }

      const cancelResult = await cancelResponse.json();
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
      if (userAccountContractId) {
        const postCancelResult = await this.utxoHandler.handlePostCancellation(
          partyId,
          tradingPair,
          orderType,
          userAccountContractId
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

