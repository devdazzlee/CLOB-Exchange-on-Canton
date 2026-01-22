/**
 * Onboarding Flow Component - Binance Style with Tailwind CSS
 * Handles external party allocation and preapproval setup
 */

import React, { useState, useEffect } from 'react';
import { walletService } from '../services/wallet';
import { onboardingService } from '../services/onboarding';
import { WalletUnlock } from './WalletUnlock';
import { WalletSetup } from './WalletSetup';

interface OnboardingFlowProps {
  onComplete: (partyId: string) => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'allocate' | 'rights' | 'preapproval' | 'complete'>('allocate');
  const [partyId, setPartyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [partyHint, setPartyHint] = useState('');
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [step1Executed, setStep1Executed] = useState(false);

  useEffect(() => {
    // Check wallet state on mount
    const state = walletService.getState();
    
    if (state.partyId) {
      setPartyId(state.partyId);
      setStep('complete');
      return;
    }

    // If wallet exists but is locked, show unlock modal
    if (walletService.hasWallet() && !state.isUnlocked) {
      setShowUnlockModal(true);
      return;
    }

    // If no wallet exists, show create modal
    if (!walletService.hasWallet()) {
      setShowCreateModal(true);
      return;
    }

    // Wallet is unlocked and no partyId - ready for onboarding
    // Auto-start Step 1 if not already executed
    if (state.isUnlocked && !step1Executed && !loading) {
      handleAutoOnboarding();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  const handleAutoOnboarding = async () => {
    // Prevent duplicate calls
    if (step1Executed || loading) {
      console.log('[OnboardingFlow] Skipping auto-onboarding: already in progress or executed');
      return;
    }
    
    try {
      setStep1Executed(true);
      setLoading(true);
      setError(null);
      console.log('[OnboardingFlow] Starting auto-onboarding...');
      const id = await onboardingService.completeOnboarding(partyHint || undefined);
      setPartyId(id);
      walletService.setPartyId(id);
      setStep('complete');
      onComplete(id);
    } catch (err: any) {
      console.error('[OnboardingFlow] Auto-onboarding failed:', err);
      setError(err.message || 'Failed to complete onboarding');
      setStep1Executed(false); // Allow retry on error
    } finally {
      setLoading(false);
    }
  };

  const handleAllocateParty = async () => {
    // Verify wallet is unlocked before starting
    const walletState = walletService.getState();
    if (!walletState.isUnlocked) {
      setError('Wallet is locked. Please unlock wallet before starting onboarding.');
      return;
    }

    // Verify private key is available
    try {
      walletService.getPrivateKey();
    } catch (err: any) {
      setError(`Private key not available: ${err.message}. Please unlock wallet first.`);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Use completeOnboarding which handles the full 2-step flow
      const id = await onboardingService.completeOnboarding(partyHint || undefined);
      setPartyId(id);
      walletService.setPartyId(id);
      setStep('complete');
      onComplete(id);
    } catch (err: any) {
      setError(err.message || 'Failed to allocate party');
    } finally {
      setLoading(false);
    }
  };

  const handleEnsureRights = async () => {
    try {
      setLoading(true);
      setError(null);
      await onboardingService.ensureUserRights(partyId!);
      setStep('preapproval');
    } catch (err: any) {
      setError(err.message || 'Failed to ensure rights');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePreapproval = async () => {
    try {
      setLoading(true);
      setError(null);
      await onboardingService.createTransferPreapproval(partyId!);
      setStep('complete');
    } catch (err: any) {
      setError(err.message || 'Failed to create transfer preapproval');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    if (partyId) {
      onComplete(partyId);
    }
  };

  const handleUnlockSuccess = () => {
    setShowUnlockModal(false);
    // Wallet is now unlocked, auto-start onboarding
    const state = walletService.getState();
    if (state.isUnlocked && !step1Executed) {
      handleAutoOnboarding();
    }
  };

  const handleCreateSuccess = () => {
    setShowCreateModal(false);
    // Wallet is now created and unlocked, auto-start onboarding
    const state = walletService.getState();
    if (state.isUnlocked && !step1Executed) {
      handleAutoOnboarding();
    }
  };

  // Show unlock modal if wallet is locked
  if (showUnlockModal) {
    return (
      <div className="min-h-screen bg-binance-primary flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <WalletUnlock
            onUnlock={handleUnlockSuccess}
            onRestore={() => {
              // TODO: Implement restore flow
              alert('Restore from seed phrase - coming soon');
            }}
          />
        </div>
      </div>
    );
  }

  // Show create wallet modal if no wallet exists
  if (showCreateModal) {
    return (
      <div className="min-h-screen bg-binance-primary flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <WalletSetup onComplete={handleCreateSuccess} />
        </div>
      </div>
    );
  }

  if (step === 'allocate') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          🌐 Allocate External Party
        </h2>
        <p className="text-binance-text-secondary mb-8">Create your unique party ID on the Canton network</p>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <div className="mb-5">
          <label className="block mb-2 font-medium text-binance-text text-sm">Party Hint (optional)</label>
          <input
            type="text"
            value={partyHint}
            onChange={(e) => setPartyHint(e.target.value)}
            placeholder="e.g., alice"
            className="w-full p-4 bg-binance-tertiary border border-binance-border rounded-lg text-sm text-binance-text transition-all duration-300 focus:outline-none focus:border-binance-blue focus:shadow-lg focus:shadow-binance-blue/10 focus:bg-binance-hover"
          />
        </div>
        <button
          onClick={handleAllocateParty}
          disabled={loading}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Allocating...
            </span>
          ) : (
            '🚀 Allocate Party'
          )}
        </button>
      </div>
    );
  }

  if (step === 'rights') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          ✅ Verify Rights
        </h2>
        <p className="text-binance-text-secondary mb-8">Ensuring you have necessary permissions on the network...</p>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <button
          onClick={handleEnsureRights}
          disabled={loading}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Verifying...
            </span>
          ) : (
            'Continue →'
          )}
        </button>
      </div>
    );
  }

  if (step === 'preapproval') {
    return (
      <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
        <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
          🔐 Create Transfer Preapproval
        </h2>
        <p className="text-binance-text-secondary mb-8">Setting up transfer preapproval for seamless trading operations...</p>
        {error && (
          <div className="p-4 bg-red-500/10 text-binance-red rounded-lg mb-5 border border-red-500/30 animate-shake">
            {error}
          </div>
        )}
        <button
          onClick={handleCreatePreapproval}
          disabled={loading}
          className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin-slow h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating...
            </span>
          ) : (
            'Continue →'
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-10 bg-binance-secondary rounded-2xl shadow-2xl border border-binance-border backdrop-blur-lg animate-slide-up">
      <h2 className="text-3xl font-semibold mb-3 bg-gradient-to-r from-binance-blue to-binance-green bg-clip-text text-transparent">
        🎉 Onboarding Complete!
      </h2>
      <p className="text-binance-text-secondary mb-4">Your party ID:</p>
      <p className="font-mono bg-binance-tertiary p-4 rounded-lg break-all border border-binance-border text-binance-green text-sm leading-relaxed mb-6">
        🔗 {partyId}
      </p>
      <p className="text-binance-text-secondary mb-8">You're now ready to trade on the CLOB Exchange!</p>
      <button
        onClick={handleComplete}
        className="w-full py-4 px-6 bg-gradient-to-r from-binance-blue to-blue-500 text-white rounded-lg font-semibold text-lg mt-6 transition-all duration-300 hover:shadow-lg hover:shadow-binance-blue/40 hover:-translate-y-0.5"
      >
        🚀 Go to Dashboard
      </button>
    </div>
  );
};
