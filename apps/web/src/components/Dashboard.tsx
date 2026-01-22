/**
 * Dashboard Component
 * Shows party ID, balances, and trading interface
 */

import React, { useState, useEffect } from 'react';
import { walletService } from '../services/wallet';
import { TradingInterface } from './trading/TradingInterface';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface Balance {
  token: string;
  amount: string;
}

export const Dashboard: React.FC = () => {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTrading, setShowTrading] = useState(false);

  useEffect(() => {
    const state = walletService.getState();
    setPartyId(state.partyId);
    fetchBalances();
    setLoading(false);
  }, []);

  const fetchBalances = async () => {
    try {
      const state = walletService.getState();
      if (!state.partyId) return;

      const response = await axios.get(`${API_BASE}/balances/${state.partyId}`);
      const balanceList = response.data.balances || [];
      
      setBalances(balanceList.map((b: any) => ({
        token: b.instrumentId,
        amount: b.amount,
      })));
    } catch (error) {
      console.error('Error fetching balances:', error);
      setBalances([]);
    }
  };

  const handleGetTestFunds = async () => {
    try {
      const state = walletService.getState();
      if (!state.partyId) {
        alert('Please complete onboarding first');
        return;
      }

      // Get available instruments
      const instrumentsResponse = await axios.get(`${API_BASE}/faucet/instruments`);
      const instruments = instrumentsResponse.data.instruments || [];

      if (instruments.length === 0) {
        alert('No instruments available for faucet');
        return;
      }

      // Use first available instrument (or let user select)
      const instrumentId = instruments[0].instrumentId || instruments[0].id;

      await axios.post(`${API_BASE}/faucet/get-funds`, {
        party: state.partyId,
        instrumentId: instrumentId,
        amount: '1000',
      });

      alert('Test funds allocated!');
      fetchBalances();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to get test funds');
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (showTrading) {
    return (
      <div>
        <button onClick={() => setShowTrading(false)}>Back to Dashboard</button>
        <TradingInterface />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <h1>CLOB Exchange Dashboard</h1>
      
      <div className="party-info">
        <h2>Your Party ID</h2>
        <p className="party-id">{partyId || 'Not allocated'}</p>
      </div>

      <div className="balances">
        <h2>Balances</h2>
        {balances.length === 0 ? (
          <p>No balances yet. Get test funds to start trading.</p>
        ) : (
          <ul>
            {balances.map((balance) => (
              <li key={balance.token}>
                {balance.token}: {balance.amount}
              </li>
            ))}
          </ul>
        )}
        <button onClick={handleGetTestFunds}>
          Get Test Funds
        </button>
      </div>

      <div className="trading-section">
        <h2>Trading</h2>
        <button onClick={() => setShowTrading(true)}>
          Open Trading Interface
        </button>
      </div>
    </div>
  );
};
