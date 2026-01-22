/**
 * Wallet Setup Component - Binance Style with Tailwind CSS
 * Handles wallet creation, encryption, and backup
 */

import React, { useState } from 'react';
import { walletService } from '../services/wallet';

interface WalletSetupProps {
  onComplete: () => void;
}

export const WalletSetup: React.FC<WalletSetupProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'create' | 'password' | 'backup' | 'confirm'>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [seedPhrase, setSeedPhrase] = useState<string[]>([]);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateWallet = async () => {
    try {
      setLoading(true);
      setError(null);
      const { seedPhrase: phrase } = await walletService.generateWallet();
      setSeedPhrase(phrase.split(' '));
      setStep('password');
    } catch (err: any) {
      console.error('Wallet creation error:', err);
      setError(err.message || 'Failed to create wallet. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setStep('backup');
  };

  const handleSaveWallet = async () => {
    if (!backupConfirmed) {
      setError('Please confirm you have saved your seed phrase');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await walletService.saveWallet(password);
      // After saving, wallet is locked - unlock it automatically for smooth UX
      await walletService.unlockWallet(password);
      
      // Automatically trigger onboarding in background
      try {
        const { onboardingService } = await import('../services/onboarding');
        const partyId = await onboardingService.completeOnboarding();
        walletService.setPartyId(partyId);
        console.log('[WalletSetup] Onboarding completed automatically, partyId:', partyId);
      } catch (onboardingErr: any) {
        console.error('[WalletSetup] Background onboarding failed (non-blocking):', onboardingErr);
        // Don't block wallet creation if onboarding fails - user can retry later
      }
      
      setStep('confirm');
      // Auto-complete after a brief delay to show confirmation
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to save wallet');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'create') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          🚀 Create Your Wallet
        </h2>
        <p className="text-binance-text-secondary mb-8 leading-relaxed">
          Generate a secure Ed25519 keypair for your non-custodial wallet. Your keys never leave your device.
        </p>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <button
          onClick={handleCreateWallet}
          disabled={loading}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 relative overflow-hidden group"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating Wallet...
            </span>
          ) : (
            '✨ Create Wallet'
          )}
        </button>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          🔐 Set Password
        </h2>
        <p className="text-binance-text-secondary mb-8">Choose a strong password to encrypt your wallet locally</p>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <div className="mb-5">
          <label className="block mt-5 mb-2 font-medium text-binance-text text-sm">Password (min 8 characters)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a strong password"
            autoFocus
            className="w-full p-4 bg-binance-tertiary border border-binance-border rounded-lg text-sm text-binance-text transition-all duration-300 focus:outline-none focus:border-binance-blue focus:shadow-lg focus:shadow-binance-blue/10 focus:bg-binance-hover"
          />
        </div>
        <div className="mb-5">
          <label className="block mt-5 mb-2 font-medium text-binance-text text-sm">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            onKeyPress={(e) => e.key === 'Enter' && handleSetPassword()}
            className="w-full p-4 bg-binance-tertiary border border-binance-border rounded-lg text-sm text-binance-text transition-all duration-300 focus:outline-none focus:border-binance-blue focus:shadow-lg focus:shadow-binance-blue/10 focus:bg-binance-hover"
          />
        </div>
        <button
          onClick={handleSetPassword}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5"
        >
          Continue →
        </button>
      </div>
    );
  }

  if (step === 'backup') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          📝 Backup Your Seed Phrase
        </h2>
        <div className="p-4 bg-yellow-500/10 text-yellow-400 rounded-lg mb-5 border border-yellow-500/30 leading-relaxed">
          ⚠️ <strong>Critical:</strong> Write down these 12 words in order and store them securely. 
          You'll need them to restore your wallet if you lose access.
        </div>
        <div className="grid grid-cols-3 gap-3 my-6">
          {seedPhrase.map((word, index) => (
            <div
              key={index}
              className="flex items-center p-4 bg-binance-tertiary rounded-lg border border-binance-border transition-all duration-300 hover:border-binance-blue hover:-translate-y-0.5 hover:shadow-lg relative overflow-hidden group"
            >
              <span className="mr-3 text-binance-text-secondary font-semibold text-xs min-w-[24px]">{index + 1}</span>
              <span className="text-binance-text font-medium text-sm">{word}</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"></div>
            </div>
          ))}
        </div>
        <div className="mb-5">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="mr-2 w-4 h-4 accent-binance-blue cursor-pointer"
            />
            <span className="text-binance-text">I have saved my seed phrase in a secure location</span>
          </label>
        </div>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <button
          onClick={handleSaveWallet}
          disabled={!backupConfirmed || loading}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Saving...
            </span>
          ) : (
            '✅ Continue'
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
      <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
        🎉 Wallet Created!
      </h2>
      <p className="text-binance-text-secondary mb-8">
        Your wallet has been created and encrypted. You're now ready to start trading on the CLOB Exchange.
      </p>
      <button
        onClick={onComplete}
        className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5"
      >
        🚀 Continue to Onboarding
      </button>
    </div>
  );
};
