/**
 * Wallet Unlock Component - Binance Style with Tailwind CSS
 * Handles wallet unlock/login
 */

import React, { useState } from 'react';
import { walletService } from '../services/wallet';

interface WalletUnlockProps {
  onUnlock: () => void;
  onRestore?: () => void;
}

export const WalletUnlock: React.FC<WalletUnlockProps> = ({ onUnlock, onRestore }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await walletService.unlockWallet(password);
      onUnlock();
    } catch (err: any) {
      setError(err.message || 'Failed to unlock wallet. Check your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
      <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
        🔓 Unlock Your Wallet
      </h2>
      <p className="text-binance-text-secondary mb-8">Enter your password to access your wallet</p>
      <form onSubmit={handleUnlock}>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <div className="mb-5">
          <label className="block mb-2 font-medium text-binance-text text-sm">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoFocus
            onKeyPress={(e) => e.key === 'Enter' && handleUnlock(e)}
            className="w-full p-4 bg-binance-tertiary border border-binance-border rounded-lg text-sm text-binance-text transition-all duration-300 focus:outline-none focus:border-binance-blue focus:shadow-lg focus:shadow-binance-blue/10 focus:bg-binance-hover"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Unlocking...
            </span>
          ) : (
            '🔓 Unlock Wallet'
          )}
        </button>
      </form>
      {onRestore && (
        <div className="mt-4 text-center">
          <button
            onClick={onRestore}
            className="text-binance-blue hover:text-blue-400 underline text-sm transition-colors"
          >
            🔄 Restore from seed phrase
          </button>
        </div>
      )}
    </div>
  );
};
