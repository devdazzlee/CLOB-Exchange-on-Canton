/**
 * Order Routes
 * Handles order placement and cancellation
 */

import { Router, Request, Response } from 'express';
import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from '../services/oauth';
import { config } from '../config';

const router = Router();
const oauthService = new OAuthService();

/**
 * POST /orders/place
 * Place a new order
 */
router.post('/place', async (req: Request, res: Response) => {
  try {
    const { party, marketId, side, orderType, price, quantity } = req.body;

    if (!party || !marketId || !side || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (orderType === 'LIMIT' && !price) {
      return res.status(400).json({ error: 'Price required for limit orders' });
    }

    const token = await oauthService.getAccessToken();
    const client = new CantonJsonApiClient({
      baseURL: config.canton.jsonApiBaseUrl,
      accessToken: token,
    });

    // TODO: Discover actual template ID and choice name
    // For now, placeholder structure - needs template discovery
    // const orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // const command: V2CreateCommand = {
    //   create: {
    //     templateId: {
    //       packageId: '',
    //       moduleName: '',
    //       entityName: '',
    //     },
    //     payload: {
    //       orderId,
    //       party,
    //       marketId,
    //       side,
    //       price: orderType === 'LIMIT' ? price : undefined,
    //       quantity,
    //       remainingQty: quantity,
    //       createdAt: new Date().toISOString(),
    //       status: 'OPEN',
    //     },
    //   },
    // };
    
    // await client.submitAndWait({
    //   applicationId: 'clob-exchange-api',
    //   commandId: crypto.randomUUID(),
    //   actAs: [party],
    //   commands: [command],
    // });
    
    throw new Error('Order placement requires template discovery - not yet implemented');

    // res.json({ success: true, orderId });
    res.status(501).json({ error: 'Order placement requires template discovery - not yet implemented' });
  } catch (error: any) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: error.message || 'Failed to place order' });
  }
});

/**
 * POST /orders/cancel
 * Cancel an order
 */
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { party, orderId } = req.body;

    if (!party || !orderId) {
      return res.status(400).json({ error: 'party and orderId are required' });
    }

    const token = await oauthService.getAccessToken();
    const client = new CantonJsonApiClient({
      baseURL: config.canton.jsonApiBaseUrl,
      accessToken: token,
    });

    // TODO: Find order contract and exercise Cancel choice
    // For now, placeholder

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error canceling order:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
});

export default router;
