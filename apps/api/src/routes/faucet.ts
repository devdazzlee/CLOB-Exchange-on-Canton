/**
 * Faucet Routes
 * Handles test fund allocation
 */

import { Router, Request, Response } from 'express';
import { FaucetService } from '../services/faucet';

const router = Router();
const faucetService = new FaucetService();

/**
 * POST /faucet/get-funds
 * Get test funds for a party
 */
router.post('/get-funds', async (req: Request, res: Response) => {
  try {
    const { party, instrumentId, amount } = req.body;

    if (!party || !instrumentId) {
      return res.status(400).json({ error: 'party and instrumentId are required' });
    }

    await faucetService.getTestFunds({
      party,
      instrumentId,
      amount,
    });

    res.json({ success: true, message: 'Test funds allocated' });
  } catch (error: any) {
    console.error('Error getting test funds:', error);
    res.status(500).json({ error: error.message || 'Failed to get test funds' });
  }
});

/**
 * GET /faucet/instruments
 * Get available instruments for faucet
 */
router.get('/instruments', async (req: Request, res: Response) => {
  try {
    const instruments = await faucetService.getAvailableInstruments();
    res.json({ instruments });
  } catch (error: any) {
    console.error('Error getting instruments:', error);
    res.status(500).json({ error: error.message || 'Failed to get instruments' });
  }
});

export default router;
