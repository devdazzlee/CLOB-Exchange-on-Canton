import { useState, useEffect } from 'react';
import {
  generateMnemonic,
  mnemonicToKeyPair,
  encryptPrivateKey,
  storeWallet,
  loadWallet,
  publicKeyToPartyId
} from '../wallet/keyManager';

export default function WalletSetup({ onWalletReady }) {
  const [step, setStep] = useState('select');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [partyId, setPartyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const existingWallet = loadWallet();
    if (existingWallet) {
      setStep('ready');
      const derivedPartyId = publicKeyToPartyId(existingWallet.publicKey);
      setPartyId(derivedPartyId);
    }
  }, []);

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
      const { publicKey, privateKey } = await mnemonicToKeyPair(mnemonic);
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      storeWallet(encryptedPrivateKey, publicKey);
      const derivedPartyId = publicKeyToPartyId(publicKey);
      setPartyId(derivedPartyId);
      setStep('ready');
      if (onWalletReady) {
        onWalletReady(derivedPartyId);
      }
    } catch (err) {
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
      const { publicKey, privateKey } = await mnemonicToKeyPair(importMnemonic.trim());
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      storeWallet(encryptedPrivateKey, publicKey);
      const derivedPartyId = publicKeyToPartyId(publicKey);
      setPartyId(derivedPartyId);
      setStep('ready');
      if (onWalletReady) {
        onWalletReady(derivedPartyId);
      }
    } catch (err) {
      setError('Failed to import wallet: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'ready') {
    return (
      <div className="card max-w-2xl mx-auto">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl font-bold text-green-400">✓</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">Wallet Ready</h2>
          <div className="bg-gray-700/50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-400 mb-2">Your Party ID</p>
            <code className="block text-blue-400 font-mono text-sm break-all bg-gray-900/50 p-3 rounded">
              {partyId}
            </code>
          </div>
          <p className="text-gray-400">Your wallet is set up and ready to use.</p>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className="card max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-6">Create New Wallet</h2>
        
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <svg className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-yellow-400 font-semibold mb-1">IMPORTANT: Save these 12 words securely!</p>
              <p className="text-yellow-300/80 text-sm">If you lose this phrase, you will lose access to your wallet permanently.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {mnemonic.split(' ').map((word, index) => (
            <div
              key={index}
              className="bg-gray-700/50 border border-gray-600 rounded-lg p-3 text-center"
            >
              <span className="text-xs text-gray-400 mr-2">{index + 1}.</span>
              <span className="text-blue-400 font-mono font-semibold">{word}</span>
            </div>
          ))}
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Password (min 8 characters)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Enter a strong password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input"
              placeholder="Confirm your password"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
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
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
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
      <h2 className="text-2xl font-bold text-white mb-2">Wallet Setup</h2>
      <p className="text-gray-400 mb-8">Create a new wallet or import an existing one using your mnemonic phrase.</p>
      
      <div className="space-y-6">
        <button
          onClick={handleCreateWallet}
          disabled={loading}
          className="btn btn-primary w-full py-4 text-lg"
        >
          {loading ? 'Generating...' : 'Create New Wallet'}
        </button>
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-gray-800 text-gray-400">OR</span>
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Import Existing Wallet</h3>
          <textarea
            placeholder="Enter your 12-word mnemonic phrase"
            value={importMnemonic}
            onChange={(e) => setImportMnemonic(e.target.value)}
            className="input resize-none h-24 font-mono text-sm"
            rows={3}
          />
          <input
            type="password"
            placeholder="Enter password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          <button
            onClick={handleImportWallet}
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
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
        <div className="mt-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
