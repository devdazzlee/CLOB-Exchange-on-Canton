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
  const [step, setStep] = useState('select'); // 'select', 'create', 'import', 'ready'
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [partyId, setPartyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if wallet already exists
    const existingWallet = loadWallet();
    if (existingWallet) {
      setStep('ready');
      // Derive party ID from public key
      const derivedPartyId = publicKeyToPartyId(existingWallet.publicKey);
      setPartyId(derivedPartyId);
    }
  }, []);

  const handleCreateWallet = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Generate mnemonic
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
      // Convert mnemonic to key pair
      const { publicKey, privateKey } = await mnemonicToKeyPair(mnemonic);
      
      // Encrypt private key
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      
      // Store wallet
      storeWallet(encryptedPrivateKey, publicKey);
      
      // Derive party ID
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
      // Convert mnemonic to key pair
      const { publicKey, privateKey } = await mnemonicToKeyPair(importMnemonic.trim());
      
      // Encrypt private key
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, password);
      
      // Store wallet
      storeWallet(encryptedPrivateKey, publicKey);
      
      // Derive party ID
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
      <div className="wallet-ready">
        <h2>Wallet Ready</h2>
        <div className="wallet-info">
          <p><strong>Party ID:</strong></p>
          <code className="party-id">{partyId}</code>
          <p className="info-text">Your wallet is set up and ready to use.</p>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className="wallet-setup">
        <h2>Create New Wallet</h2>
        <div className="mnemonic-display">
          <p className="warning">⚠️ IMPORTANT: Save these 12 words in a secure location!</p>
          <p className="warning">If you lose this phrase, you will lose access to your wallet.</p>
          <div className="mnemonic-words">
            {mnemonic.split(' ').map((word, index) => (
              <span key={index} className="mnemonic-word">
                {index + 1}. {word}
              </span>
            ))}
          </div>
        </div>
        <div className="password-section">
          <input
            type="password"
            placeholder="Enter password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="password-input"
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="password-input"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button
          onClick={handleConfirmCreate}
          disabled={loading}
          className="btn btn-primary"
        >
          {loading ? 'Creating...' : 'Confirm & Create Wallet'}
        </button>
        <button
          onClick={() => setStep('select')}
          className="btn btn-secondary"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-setup">
      <h2>Wallet Setup</h2>
      <p>Create a new wallet or import an existing one using your mnemonic phrase.</p>
      
      <div className="wallet-options">
        <button
          onClick={handleCreateWallet}
          disabled={loading}
          className="btn btn-primary btn-large"
        >
          Create New Wallet
        </button>
        
        <div className="divider">OR</div>
        
        <div className="import-section">
          <h3>Import Existing Wallet</h3>
          <textarea
            placeholder="Enter your 12-word mnemonic phrase"
            value={importMnemonic}
            onChange={(e) => setImportMnemonic(e.target.value)}
            className="mnemonic-input"
            rows={3}
          />
          <input
            type="password"
            placeholder="Enter password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="password-input"
          />
          <button
            onClick={handleImportWallet}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Importing...' : 'Import Wallet'}
          </button>
        </div>
      </div>
      
      {error && <div className="error">{error}</div>}
    </div>
  );
}

