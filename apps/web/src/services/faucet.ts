/**
 * Faucet Service (Frontend)
 * Handles test fund requests
 */

import axios from 'axios';
import { walletService } from './wallet';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export interface FaucetRequest {
  instrumentId: string;
  amount?: string;
}

export class FaucetService {
  /**
   * Get test funds
   */
  async getTestFunds(request: FaucetRequest): Promise<void> {
    const state = walletService.getState();
    if (!state.partyId) {
      throw new Error('Party ID not found. Please complete onboarding.');
    }

    await axios.post(`${API_BASE_URL}/faucet/get-funds`, {
      party: state.partyId,
      instrumentId: request.instrumentId,
      amount: request.amount || '1000.0',
    });
  }

  /**
   * Get available instruments
   */
  async getAvailableInstruments(): Promise<any[]> {
    const response = await axios.get(`${API_BASE_URL}/faucet/instruments`);
    return response.data.instruments || [];
  }
}

export const faucetService = new FaucetService();
