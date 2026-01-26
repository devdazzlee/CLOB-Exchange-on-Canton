/**
 * TradingService - Splice Allocation Model Implementation
 * 
 * This service implements the two-step order placement process:
 * Step A: Create Allocation (Lock Funds)
 * Step B: Place Order with Allocation CID
 * 
 * Based on Splice Token Standard and Allocation Model from TradingApp.daml
 */

import { 
  queryContracts, 
  exerciseChoice, 
  queryContractsAtOffset,
  fetchContract 
} from './cantonApi';

// Operator Party ID (The Venue)
const OPERATOR_PARTY_ID = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

/**
 * Parse trading pair to extract base and quote tokens
 */
function parseTradingPair(pair: string): { base: string; quote: string } {
  if (pair.includes('/')) {
    const [base, quote] = pair.split('/');
    return { base, quote };
  } else if (pair.includes('-')) {
    const [base, quote] = pair.split('-');
    return { base, quote };
  }
  return { base: 'BTC', quote: 'USDT' }; // Default
}

/**
 * Find Token contracts (UTXOs) for a user
 * @param partyId - User's party ID
 * @param currency - Currency to find (e.g., "USDT", "BTC")
 * @param minAmount - Minimum amount required
 * @returns Array of Token contracts with sufficient balance
 */
export async function findTokenContracts(
  partyId: string, 
  currency: string, 
  minAmount: string
): Promise<Array<any>> {
  console.log('[TradingService] Finding Token contracts for:', { partyId, currency, minAmount });

  const tokenTemplates = ['Token:Token', 'UTXO:UTXO', 'TokenBalance:TokenBalance'];
  
  for (const templateId of tokenTemplates) {
    try {
      const tokens = await queryContracts(templateId, partyId);
      console.log(`[TradingService] Found ${tokens.length} contracts for template ${templateId}`);
      
      const matchingTokens = tokens.filter((token: any) => {
        const tokenCurrency = token.payload?.currency || token.payload?.tokenType || token.payload?.asset;
        const tokenAmount = parseFloat(token.payload?.amount || token.payload?.quantity || '0');
        return tokenCurrency === currency && tokenAmount >= parseFloat(minAmount);
      });

      if (matchingTokens.length > 0) {
        console.log(`[TradingService] ✅ Found ${matchingTokens.length} matching Token contracts`);
        return matchingTokens;
      }
    } catch (err: any) {
      console.warn(`[TradingService] Template ${templateId} not found:`, err.message);
      continue;
    }
  }

  throw new Error(`No Token contracts found for ${currency} with sufficient balance (need ${minAmount})`);
}

/**
 * Create an Allocation by locking funds using Splice Token Standard
 * This is Step A of the two-step order placement process
 * 
 * @param tokenContractId - Contract ID of the Token to lock
 * @param partyId - User's party ID
 * @param amount - Amount to lock
 * @param currency - Currency/token type (e.g., "USDT", "BTC")
 * @returns Allocation contract ID
 */
export async function createAllocation(
  tokenContractId: string,
  partyId: string,
  amount: string,
  currency: string
): Promise<string> {
  try {
    console.log('[TradingService] Step A: Creating Allocation...', {
      tokenContractId: tokenContractId.substring(0, 30) + '...',
      partyId,
      operatorPartyId: OPERATOR_PARTY_ID,
      amount,
      currency
    });

    // Try to exercise Token_Lock choice on the Token contract
    // Note: The exact choice name may vary based on Splice version
    const choiceName = 'Token_Lock'; // Adjust based on actual Splice API
    
    // Build the choice argument based on Splice Allocation model
    // This follows the pattern from TradingApp.daml
    const choiceArgument = {
      receiver: partyId, // User receives the locked allocation
      provider: OPERATOR_PARTY_ID, // Operator can execute
      amount: amount,
      currency: currency,
      // Additional fields may be required based on Splice API
      // settlementRef: ...,
      // metadata: ...
    };

    console.log('[TradingService] Exercising Token_Lock with argument:', choiceArgument);

    // Exercise the choice to create Allocation
    const result = await exerciseChoice(
      tokenContractId,
      choiceName,
      choiceArgument,
      partyId,
      'Token:Token' // Template ID - adjust based on actual Splice Token template
    );

    console.log('[TradingService] Token_Lock result:', result);

    // Extract Allocation contract ID from the result
    if (result.updateId && result.completionOffset !== undefined) {
      // Wait a bit for the Allocation to be visible
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Query for the newly created Allocation contract
      // Try multiple template names as Splice may use different naming
      const allocationTemplates = [
        'Allocation:Allocation',
        'Api.Token.AllocationV1:Allocation',
        'Splice.Api.Token.AllocationV1:Allocation'
      ];
      
      let allocationCid: string | null = null;
      for (const templateId of allocationTemplates) {
        try {
          const allocations = await queryContractsAtOffset(
            templateId,
            partyId,
            result.completionOffset
          );

          if (allocations.length > 0) {
            // Find the most recent Allocation (last in array)
            allocationCid = allocations[allocations.length - 1].contractId;
            console.log('[TradingService] ✅ Allocation created:', allocationCid.substring(0, 30) + '...');
            return allocationCid;
          }
        } catch (err) {
          console.warn(`[TradingService] Template ${templateId} not found:`, err);
          continue;
        }
      }

      // Fallback: Try current ledger end
      for (const templateId of allocationTemplates) {
        try {
          const allocationsCurrent = await queryContracts(templateId, partyId);
          if (allocationsCurrent.length > 0) {
            allocationCid = allocationsCurrent[allocationsCurrent.length - 1].contractId;
            console.log('[TradingService] ✅ Allocation found at current ledger end:', allocationCid.substring(0, 30) + '...');
            return allocationCid;
          }
        } catch (err) {
          continue;
        }
      }
    }

    throw new Error('Failed to create Allocation: Allocation contract not found after creation');
  } catch (error: any) {
    console.error('[TradingService] Error creating Allocation:', error);
    throw new Error(`Failed to create Allocation: ${error.message}`);
  }
}

/**
 * Place an order using the Splice Allocation model (Two-Step Process)
 * 
 * Step A: Create Allocation (Lock Funds)
 * Step B: Place Order with Allocation CID
 * 
 * @param orderData - Order placement data
 * @returns Order placement result
 */
export async function placeOrder(orderData: {
  partyId: string;
  tradingPair: string;
  orderType: 'BUY' | 'SELL';
  orderMode?: 'LIMIT' | 'MARKET';
  quantity: string;
  price?: string | null;
  orderBookContractId?: string | null;
}): Promise<{
  success: boolean;
  orderId?: string;
  allocationCid?: string;
  orderContractId?: string;
  updateId?: string;
  completionOffset?: number;
  error?: string;
}> {
  try {
    const { partyId, tradingPair, orderType, orderMode = 'LIMIT', quantity, price, orderBookContractId } = orderData;

    // Validate inputs
    if (!partyId || !tradingPair || !orderType || !quantity) {
      throw new Error('Missing required fields: partyId, tradingPair, orderType, quantity');
    }

    if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      throw new Error('Price required for limit orders');
    }

    // Parse trading pair to determine which token to lock
    const { base, quote } = parseTradingPair(tradingPair);
    
    // BUY order: lock quote token (USDT) to buy base token (BTC)
    // SELL order: lock base token (BTC) to sell for quote token (USDT)
    const tokenToLock = orderType === 'BUY' ? quote : base;
    const lockAmount = quantity; // For BUY: amount of USDT, For SELL: amount of BTC
    
    console.log('[TradingService] Splice Allocation Flow:', {
      orderType,
      tokenToLock,
      lockAmount,
      tradingPair: `${base}/${quote}`
    });

    // ============================================================================
    // STEP A: Create Allocation (Lock Funds)
    // ============================================================================
    console.log('[TradingService] Step A: Creating Allocation...');
    
    // Find user's Token contracts with sufficient balance
    const tokenContracts = await findTokenContracts(partyId, tokenToLock, lockAmount);
    
    if (tokenContracts.length === 0) {
      throw new Error(`Insufficient ${tokenToLock} balance. Need ${lockAmount} ${tokenToLock} to place this order.`);
    }
    
    // Use the first matching token contract
    const tokenContract = tokenContracts[0];
    console.log('[TradingService] Using Token contract:', tokenContract.contractId.substring(0, 30) + '...');
    
    // Create Allocation by locking the token
    let allocationCid: string;
    try {
      allocationCid = await createAllocation(
        tokenContract.contractId,
        partyId,
        lockAmount,
        tokenToLock
      );
      console.log('[TradingService] ✅ Step A Complete: Allocation created:', allocationCid.substring(0, 30) + '...');
    } catch (allocationError: any) {
      console.error('[TradingService] ❌ Step A Failed: Allocation creation error:', allocationError);
      throw new Error(`Failed to create Allocation: ${allocationError.message}. Please ensure you have sufficient ${tokenToLock} balance.`);
    }
    
    // ============================================================================
    // STEP B: Wait for Allocation to be confirmed
    // ============================================================================
    console.log('[TradingService] Step B: Waiting for Allocation confirmation...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // ============================================================================
    // STEP C: Place Order with Allocation CID
    // ============================================================================
    console.log('[TradingService] Step C: Placing order with Allocation CID...');
    
    // Get MasterOrderBook contract ID
    let masterOrderBookContractId = orderBookContractId || null;
    
    if (!masterOrderBookContractId) {
      // Try to find MasterOrderBook for this trading pair
      try {
        const orderBooks = await queryContracts('MasterOrderBook:MasterOrderBook', partyId);
        const matchingBook = orderBooks.find((ob: any) => ob.payload?.tradingPair === tradingPair);
        if (matchingBook) {
          masterOrderBookContractId = matchingBook.contractId;
          console.log('[TradingService] Found MasterOrderBook:', masterOrderBookContractId.substring(0, 30) + '...');
        }
      } catch (err) {
        console.warn('[TradingService] Could not query MasterOrderBook:', err);
      }
    }
    
    if (!masterOrderBookContractId) {
      throw new Error(`MasterOrderBook not found for ${tradingPair}. Please ensure the order book is initialized.`);
    }
    
    // Generate order ID
    const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Build AddOrder choice argument
    const addOrderArgument = {
      orderId: orderId,
      owner: partyId,
      orderType: orderType,
      orderMode: orderMode,
      price: orderMode === 'LIMIT' && price ? { Some: price } : { None: null },
      quantity: quantity,
      allocationCid: allocationCid // CRITICAL: Pass the Allocation CID from Step A
    };
    
    console.log('[TradingService] Exercising MasterOrderBook:AddOrder with:', {
      orderId,
      allocationCid: allocationCid.substring(0, 30) + '...',
      orderType,
      quantity
    });
    
    // Exercise AddOrder choice on MasterOrderBook
    const result = await exerciseChoice(
      masterOrderBookContractId,
      'AddOrder',
      addOrderArgument,
      partyId,
      'MasterOrderBook:MasterOrderBook'
    );
    
    console.log('[TradingService] ✅ Order placed successfully:', {
      orderId,
      updateId: result.updateId,
      completionOffset: result.completionOffset
    });
    
    return {
      success: true,
      orderId: orderId,
      allocationCid: allocationCid,
      orderContractId: result.createdOrderContractId,
      updateId: result.updateId,
      completionOffset: result.completionOffset
    };
    
  } catch (error: any) {
    console.error('[TradingService] Error placing order:', error);
    return {
      success: false,
      error: error.message || 'Failed to place order'
    };
  }
}

/**
 * Cancel an order (releases the Allocation)
 */
export async function cancelOrder(
  orderContractId: string,
  partyId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch the order to get its details
    const order = await fetchContract(orderContractId, partyId);
    if (!order) {
      throw new Error('Order not found');
    }
    
    // Exercise CancelOrder choice on the Order contract
    // This will cancel the Allocation and unlock the funds
    await exerciseChoice(
      orderContractId,
      'CancelOrder',
      {},
      partyId,
      'Order:Order'
    );
    
    console.log('[TradingService] ✅ Order cancelled successfully');
    
    return { success: true };
  } catch (error: any) {
    console.error('[TradingService] Error cancelling order:', error);
    return {
      success: false,
      error: error.message || 'Failed to cancel order'
    };
  }
}
