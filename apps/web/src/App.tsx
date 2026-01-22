/**
 * Main App Component
 * Handles wallet state and routing
 */

import React, { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './contexts/WalletContext';
import { WalletSetup } from './components/WalletSetup';
import { WalletUnlock } from './components/WalletUnlock';
import { Dashboard } from './components/Dashboard';
import { walletService } from './services/wallet';

type AppState = 'setup' | 'unlock' | 'dashboard';

const AppContent: React.FC = () => {
  const { walletState, hasWallet, isUnlocked, partyId, lockWallet, refreshState } = useWallet();
  const [state, setState] = useState<AppState>('setup');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Initialize app state on mount
    const initializeApp = () => {
      refreshState(); // Ensure state is fresh
      
      if (hasWallet) {
        if (isUnlocked) {
          // Wallet is unlocked - always go to dashboard
          // If no partyId, onboarding will happen in background (only once)
          setState('dashboard');
          
          // Trigger onboarding in background if needed (only if not already in progress)
          if (!partyId) {
            // Use a flag to prevent multiple simultaneous calls
            const onboardingKey = 'onboarding_in_progress';
            if (!sessionStorage.getItem(onboardingKey)) {
              sessionStorage.setItem(onboardingKey, 'true');
              (async () => {
                try {
                  const { onboardingService } = await import('./services/onboarding');
                  const newPartyId = await onboardingService.completeOnboarding();
                  walletService.setPartyId(newPartyId);
                  refreshState();
                } catch (err: any) {
                  console.error('[App] Background onboarding failed:', err);
                  // Clear flag on error so it can retry
                  sessionStorage.removeItem(onboardingKey);
                } finally {
                  // Clear flag after completion (success or failure)
                  sessionStorage.removeItem(onboardingKey);
                }
              })();
            }
          }
        } else {
          // Wallet exists but locked - show unlock
          setState('unlock');
        }
      } else {
        // No wallet - show setup
        setState('setup');
      }
      setIsInitialized(true);
    };

    initializeApp();
  }, [hasWallet, isUnlocked, partyId, refreshState]);

  // Update state when wallet state changes
  useEffect(() => {
    if (!isInitialized) return;

    if (hasWallet) {
      if (isUnlocked) {
        // Always go to dashboard - onboarding happens in background
        setState('dashboard');
        
        // Trigger onboarding in background if needed (only if not already in progress)
        if (!partyId) {
          const onboardingKey = 'onboarding_in_progress';
          if (!sessionStorage.getItem(onboardingKey)) {
            sessionStorage.setItem(onboardingKey, 'true');
            (async () => {
              try {
                const { onboardingService } = await import('./services/onboarding');
                const newPartyId = await onboardingService.completeOnboarding();
                walletService.setPartyId(newPartyId);
                refreshState();
              } catch (err: any) {
                console.error('[App] Background onboarding failed:', err);
                sessionStorage.removeItem(onboardingKey);
              } finally {
                sessionStorage.removeItem(onboardingKey);
              }
            })();
          }
        }
      } else {
        setState('unlock');
      }
    } else {
      setState('setup');
    }
  }, [hasWallet, isUnlocked, partyId, isInitialized, refreshState]);

  const handleWalletCreated = async () => {
    // After wallet creation, automatically trigger onboarding in background
    refreshState();
    
    if (isUnlocked) {
      // If no partyId yet, trigger onboarding silently in background
      if (!partyId) {
        try {
          const { onboardingService } = await import('./services/onboarding');
          const newPartyId = await onboardingService.completeOnboarding();
          walletService.setPartyId(newPartyId);
          refreshState();
        } catch (err: any) {
          console.error('[App] Background onboarding failed:', err);
          // Continue to dashboard anyway - onboarding can retry later
        }
      }
      // Always go to dashboard (onboarding happens in background)
      setState('dashboard');
    } else {
      // If somehow not unlocked, show unlock screen
      setState('unlock');
    }
  };

  const handleWalletUnlocked = () => {
    // After unlock, trigger onboarding in background if needed, then go to dashboard
    refreshState();
    
    if (!partyId) {
      // Trigger onboarding silently in background
      (async () => {
        try {
          const { onboardingService } = await import('./services/onboarding');
          const newPartyId = await onboardingService.completeOnboarding();
          walletService.setPartyId(newPartyId);
          refreshState();
        } catch (err: any) {
          console.error('[App] Background onboarding failed:', err);
        }
      })();
    }
    
    // Always go to dashboard (onboarding happens in background)
    setState('dashboard');
  };


  const handleLogout = () => {
    lockWallet();
    refreshState();
    setState('unlock');
  };

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-binance-primary flex items-center justify-center">
        <div className="text-binance-text">Loading...</div>
      </div>
    );
  }

  if (state === 'setup') {
    return <WalletSetup onComplete={handleWalletCreated} />;
  }

  if (state === 'unlock') {
    return (
      <WalletUnlock
        onUnlock={handleWalletUnlocked}
        onRestore={() => {
          // TODO: Implement restore flow
          alert('Restore from seed phrase - coming soon');
        }}
      />
    );
  }

  // Onboarding removed - happens automatically in background

  return (
    <div>
      <div className="header">
        <h1>CLOB Exchange</h1>
        <button onClick={handleLogout}>Logout</button>
      </div>
      <Dashboard />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  );
};
