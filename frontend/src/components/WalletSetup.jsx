import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  generateMnemonic,
  mnemonicToKeyPair,
  encryptPrivateKey,
  storeWallet,
  loadWallet,
} from '../wallet/keyManager';
import { createPartyForUser } from '../services/partyService';
import { storeTokens } from '../services/keycloakAuth';
import PasswordInput from './PasswordInput';

export default function WalletSetup({ onWalletReady }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('select');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [partyId, setPartyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedPartyId, setCopiedPartyId] = useState(false);

  useEffect(() => {
    const existingWallet = loadWallet();
    if (existingWallet) {
      const storedPartyId = localStorage.getItem('canton_party_id');
      if (storedPartyId) {
        setStep('ready');
        setPartyId(storedPartyId);
        return;
      }

      // No fallback: if partyId isn't stored, re-register it via backend using the stored wallet public key.
      (async () => {
        try {
          setLoading(true);
          setError('');
          console.log('[WalletSetup] Wallet found but no canton_party_id stored. Re-registering party...');
          const partyResult = await createPartyForUser(existingWallet.publicKey);
          const allocatedPartyId = partyResult.partyId;
          setPartyId(allocatedPartyId);
          localStorage.setItem('canton_party_id', allocatedPartyId);

          if (partyResult.token) {
            storeTokens(partyResult.token, null, 1800);
          }

          setStep('ready');
          onWalletReady?.(allocatedPartyId);
        } catch (err) {
          console.error('[WalletSetup] Failed to re-register party:', err);
          setError('Wallet found but Party ID is not registered. Please create/register party again: ' + err.message);
          setStep('select');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, []);

  const handleCopyPartyId = async () => {
    try {
      await navigator.clipboard.writeText(partyId);
      setCopiedPartyId(true);
      setTimeout(() => setCopiedPartyId(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy Party ID:', err);
    }
  };

  const handleCreateWallet = async () => {
    setLoading(true);
    setError('');
    
    try {
      const newMnemonic = generateMnemonic();
      setMnemonic(newMnemonic);
      setStep('create');
    } catch (err) {
      setError('Failed to generate wallet: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Clear old localStorage data before creating new wallet (as per client feedback)
      // This fixes the issue where old tokens prevent proper navigation after wallet creation
      console.log('[WalletSetup] Clearing old localStorage data before creating new wallet...');
      const keysToClear = [
        'canton_jwt_token',
        'canton_jwt_token_expires',
        'canton_party_id',
        'keycloak_access_token',
        'keycloak_refresh_token',
        'keycloak_token_expires_at'
      ];
      
      keysToClear.forEach(key => {
        if (localStorage.getItem(key)) {
          console.log(`[WalletSetup] Clearing old ${key}`);
          localStorage.removeItem(key);
        }
      });
      
      // Also clear any order book offsets that might be stale
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('orderBook_') || key.startsWith('latestOrder_')) {
          console.log(`[WalletSetup] Clearing stale ${key}`);
          localStorage.removeItem(key);
        }
      });
      
      console.log('[WalletSetup] ✅ Old localStorage data cleared');

      // 1. Create wallet locally
      const { publicKey, privateKey } = await mnemonicToKeyPair(mnemonic);
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      storeWallet(encryptedPrivateKey, publicKey);
      
      // 2. Create party ID on backend (on behalf of user)
      console.log('[WalletSetup] Creating party ID on backend...');
      const partyResult = await createPartyForUser(publicKey);
      
      // ============================================
      // CRITICAL DEBUG: Check what we received
      // ============================================
      console.log('[WalletSetup] ===== PARTY RESULT RECEIVED =====');
      console.log('[WalletSetup] Full partyResult:', partyResult);
      console.log('[WalletSetup] partyResult.partyId:', partyResult?.partyId);
      console.log('[WalletSetup] partyResult.token exists:', !!partyResult?.token);
      console.log('[WalletSetup] partyResult.token type:', typeof partyResult?.token);
      console.log('[WalletSetup] partyResult.token value:', partyResult?.token);
      console.log('[WalletSetup] partyResult.token length:', partyResult?.token?.length);
      console.log('[WalletSetup] ===================================');
      
      // 3. Store the party ID
      const derivedPartyId = partyResult.partyId;
      setPartyId(derivedPartyId);
      localStorage.setItem('canton_party_id', derivedPartyId);
      
      // 4. If backend provided a token, store it
      if (partyResult.token) {
        console.log('[WalletSetup] ✓ Token found! Storing authentication token...');
        console.log('[WalletSetup] Token length:', partyResult.token.length);
        console.log('[WalletSetup] Token preview:', partyResult.token.substring(0, 50) + '...');
        // Store token with 30 minute expiry (adjust as needed)
        storeTokens(partyResult.token, null, 1800);
        console.log('[WalletSetup] ✓ Token stored successfully');
      } else {
        console.error('[WalletSetup] ✗ CRITICAL: No token in partyResult!');
        console.error('[WalletSetup] partyResult object:', JSON.stringify(partyResult, null, 2));
        console.warn('[WalletSetup] No token provided by backend. User may need to authenticate separately.');
      }
      
      setStep('ready');
      if (onWalletReady) {
        onWalletReady(derivedPartyId);
      }
    } catch (err) {
      console.error('[WalletSetup] Error creating wallet/party:', err);
      setError('Failed to create wallet: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    if (!importMnemonic.trim()) {
      setError('Please enter your mnemonic phrase');
      return;
    }

    const words = importMnemonic.trim().split(/\s+/);
    if (words.length !== 12) {
      setError('Mnemonic must be exactly 12 words');
      return;
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Clear old localStorage data before importing wallet (as per client feedback)
      console.log('[WalletSetup] Clearing old localStorage data before importing wallet...');
      const keysToClear = [
        'canton_jwt_token',
        'canton_jwt_token_expires',
        'canton_party_id',
        'keycloak_access_token',
        'keycloak_refresh_token',
        'keycloak_token_expires_at'
      ];
      
      keysToClear.forEach(key => {
        if (localStorage.getItem(key)) {
          console.log(`[WalletSetup] Clearing old ${key}`);
          localStorage.removeItem(key);
        }
      });
      
      // Also clear any order book offsets that might be stale
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('orderBook_') || key.startsWith('latestOrder_')) {
          console.log(`[WalletSetup] Clearing stale ${key}`);
          localStorage.removeItem(key);
        }
      });
      
      console.log('[WalletSetup] ✅ Old localStorage data cleared');

      // 1. Import wallet locally
      const { publicKey, privateKey } = await mnemonicToKeyPair(importMnemonic.trim());
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      storeWallet(encryptedPrivateKey, publicKey);
      
      // 2. Create party ID on backend (on behalf of user)
      console.log('[WalletSetup] Creating party ID on backend for imported wallet...');
      const partyResult = await createPartyForUser(publicKey);
      
      // ============================================
      // CRITICAL DEBUG: Check what we received
      // ============================================
      console.log('[WalletSetup] ===== PARTY RESULT RECEIVED (IMPORT) =====');
      console.log('[WalletSetup] Full partyResult:', partyResult);
      console.log('[WalletSetup] partyResult.partyId:', partyResult?.partyId);
      console.log('[WalletSetup] partyResult.token exists:', !!partyResult?.token);
      console.log('[WalletSetup] partyResult.token type:', typeof partyResult?.token);
      console.log('[WalletSetup] partyResult.token value:', partyResult?.token);
      console.log('[WalletSetup] partyResult.token length:', partyResult?.token?.length);
      console.log('[WalletSetup] ===========================================');
      
      // 3. Store the party ID
      const derivedPartyId = partyResult.partyId;
      setPartyId(derivedPartyId);
      localStorage.setItem('canton_party_id', derivedPartyId);
      
      // 4. If backend provided a token, store it
      if (partyResult.token) {
        console.log('[WalletSetup] ✓ Token found! Storing authentication token...');
        console.log('[WalletSetup] Token length:', partyResult.token.length);
        console.log('[WalletSetup] Token preview:', partyResult.token.substring(0, 50) + '...');
        // Store token with 30 minute expiry (adjust as needed)
        storeTokens(partyResult.token, null, 1800);
        console.log('[WalletSetup] ✓ Token stored successfully');
      } else {
        console.error('[WalletSetup] ✗ CRITICAL: No token in partyResult!');
        console.error('[WalletSetup] partyResult object:', JSON.stringify(partyResult, null, 2));
        console.warn('[WalletSetup] No token provided by backend. User may need to authenticate separately.');
      }
      
      setStep('ready');
      if (onWalletReady) {
        onWalletReady(derivedPartyId);
      }
    } catch (err) {
      console.error('[WalletSetup] Error importing wallet/party:', err);
      setError('Failed to import wallet: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'ready') {
    return (
      <div className="card max-w-2xl mx-auto">
        <div className="text-center">
          <div className="w-20 h-20 bg-success-light rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-success">
            <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-[#EAECEF] mb-2">Wallet Ready</h2>
          <p className="text-[#848E9C] mb-6">Your wallet is set up and ready to use.</p>
          <div className="bg-[#1E2329] border border-[#2B3139] rounded-lg p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[#848E9C] font-medium">Your Party ID</p>
              <button
                onClick={handleCopyPartyId}
                className="p-2 hover:bg-[#2B3139] rounded-md transition-colors group"
                title={copiedPartyId ? "Copied!" : "Copy Party ID"}
              >
                {copiedPartyId ? (
                  <svg className="w-4 h-4 text-success transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-[#848E9C] group-hover:text-[#F0B90B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
            <code className="block text-primary font-mono text-sm break-all bg-[#0B0E11] p-4 rounded border border-[#2B3139]">
              {partyId}
            </code>
          </div>
          <button
            onClick={() => {
              // Navigate to trading interface using React Router
              navigate('/trading');
            }}
            className="btn btn-primary w-full py-3 text-base font-semibold"
          >
            Go to Trading Interface
          </button>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className="card max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-[#EAECEF] mb-6">Create New Wallet</h2>
        
        <div className="bg-[#F0B90B15] border border-[#F0B90B40] rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-primary font-semibold mb-1">IMPORTANT: Save these 12 words securely!</p>
              <p className="text-[#848E9C] text-sm">If you lose this phrase, you will lose access to your wallet permanently.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {mnemonic.split(' ').map((word, index) => (
            <div
              key={index}
              className="bg-[#1E2329] border border-[#2B3139] rounded-lg p-3 text-center hover:border-[#3A4149] transition-colors"
            >
              <span className="text-xs text-[#848E9C] mr-2">{index + 1}.</span>
              <span className="text-primary font-mono font-semibold">{word}</span>
            </div>
          ))}
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-[#EAECEF] mb-2">
              Password (min 8 characters)
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#EAECEF] mb-2">
              Confirm Password
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
            />
          </div>
        </div>

        {error && (
          <div className="bg-danger-light border border-danger rounded-lg p-4 mb-4">
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        <div className="flex space-x-3">
          <button
            onClick={handleConfirmCreate}
            disabled={loading}
            className="btn btn-primary flex-1"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </span>
            ) : (
              'Confirm & Create Wallet'
            )}
          </button>
          <button
            onClick={() => setStep('select')}
            className="btn btn-secondary"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-[#EAECEF] mb-2">Wallet Setup</h2>
      <p className="text-[#848E9C] mb-8">Create a new wallet or import an existing one using your mnemonic phrase.</p>
      
      <div className="space-y-6">
        <button
          onClick={handleCreateWallet}
          disabled={loading}
          className="btn btn-primary w-full py-4 text-base font-semibold"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </span>
          ) : (
            'Create New Wallet'
          )}
        </button>
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#2B3139]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-[#181A20] text-[#848E9C]">OR</span>
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#EAECEF]">Import Existing Wallet</h3>
          <textarea
            placeholder="Enter your 12-word mnemonic phrase"
            value={importMnemonic}
            onChange={(e) => setImportMnemonic(e.target.value)}
            className="input resize-none h-24 font-mono text-sm"
            rows={3}
          />
          <PasswordInput
            placeholder="Enter password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            onClick={handleImportWallet}
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Importing...
              </span>
            ) : (
              'Import Wallet'
            )}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="mt-6 bg-danger-light border border-danger rounded-lg p-4">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
