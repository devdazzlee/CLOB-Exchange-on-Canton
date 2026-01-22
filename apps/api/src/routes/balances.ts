/**
 * Balance Routes
 * Handles balance queries
 */

import { Router, Request, Response } from 'express';
import { BalanceService } from '../services/balance';

const router = Router();
const balanceService = new BalanceService();

/**
 * GET /balances/:party
 * Get all balances for a party
 */
router.get('/:party', async (req: Request, res: Response) => {
  try {
    const { party } = req.params;
    const balances = await balanceService.getBalances(party);
    res.json({ balances });
  } catch (error: any) {
    console.error('Error getting balances:', error);
    res.status(500).json({ error: error.message || 'Failed to get balances' });
  }
});

/**
 * GET /balances/:party/:instrumentId
 * Get balance for specific instrument
 */
router.get('/:party/:instrumentId', async (req: Request, res: Response) => {
  try {
    const { party, instrumentId } = req.params;
    const balance = await balanceService.getBalance(party, instrumentId);
    
    if (!balance) {
      return res.status(404).json({ error: 'Balance not found' });
    }
    
    res.json({ balance });
  } catch (error: any) {
    console.error('Error getting balance:', error);
    res.status(500).json({ error: error.message || 'Failed to get balance' });
  }
});

export default router;
