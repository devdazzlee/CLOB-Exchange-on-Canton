/**
 * Wallet Context Provider
 * Provides wallet state and operations to all components
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { walletService, WalletState } from '../services/wallet';

interface WalletContextValue {
  walletState: WalletState;
  hasWallet: boolean;
  isUnlocked: boolean;
  partyId: string | null;
  createWallet: () => Promise<{ publicKey: Uint8Array; seedPhrase: string }>;
  unlockWallet: (password: string) => Promise<void>;
  lockWallet: () => void;
  saveWallet: (password: string) => Promise<void>;
  setPartyId: (partyId: string) => void;
  refreshState: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [walletState, setWalletState] = useState<WalletState>(walletService.getState());
  const [hasWallet, setHasWallet] = useState(walletService.hasWallet());

  const refreshState = useCallback(() => {
    setWalletState(walletService.getState());
    setHasWallet(walletService.hasWallet());
  }, []);

  useEffect(() => {
    // Initial state
    refreshState();

    // Listen for wallet changes (if walletService emits events in the future)
    // For now, we'll refresh on mount and after operations
  }, [refreshState]);

  const createWallet = useCallback(async () => {
    const result = await walletService.generateWallet();
    refreshState();
    return result;
  }, [refreshState]);

  const unlockWallet = useCallback(async (password: string) => {
    await walletService.unlockWallet(password);
    refreshState();
  }, [refreshState]);

  const lockWallet = useCallback(() => {
    walletService.lockWallet();
    refreshState();
  }, [refreshState]);

  const saveWallet = useCallback(async (password: string) => {
    await walletService.saveWallet(password);
    refreshState();
  }, [refreshState]);

  const setPartyId = useCallback((partyId: string) => {
    walletService.setPartyId(partyId);
    refreshState();
  }, [refreshState]);

  const value: WalletContextValue = {
    walletState,
    hasWallet,
    isUnlocked: walletState.isUnlocked,
    partyId: walletState.partyId,
    createWallet,
    unlockWallet,
    lockWallet,
    saveWallet,
    setPartyId,
    refreshState,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
