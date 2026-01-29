import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  generateMnemonic,
  mnemonicToKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  storeWallet,
  loadWallet,
  bytesToBase64,
  signMessage,
} from '../wallet/keyManager';
import {
  createOnboardingMaterial,
  allocateExternalParty,
  generateAuthChallenge,
  unlockWallet,
  storeSessionToken,
  getStoredSessionToken
} from '../services/walletService';
import PasswordInput from './PasswordInput';

export default function WalletSetupNew({ onWalletReady }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('select');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [walletId, setWalletId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedWalletId, setCopiedWalletId] = useState(false);

  // 2-step onboarding state
  const [onboardingData, setOnboardingData] = useState(null);
  const [keyPair, setKeyPair] = useState(null);

  // Prevent duplicate API calls
  const onboardingInProgress = useRef(false);

  useEffect(() => {
    // Check for existing session
    const { walletId: storedWalletId, sessionToken } = getStoredSessionToken();
    if (storedWalletId && sessionToken) {
      setStep('ready');
      setWalletId(storedWalletId);
      if (onWalletReady) {
        onWalletReady({ walletId, sessionToken });
      }
      return;
    }

    // Check for existing wallet but no session
    const existingWallet = loadWallet();
    if (existingWallet) {
      setStep('unlock');
      return;
    }
  }, []);

  const generateNewWallet = () => {
    try {
      const newMnemonic = generateMnemonic();
      setMnemonic(newMnemonic);
      setStep('create');
    } catch (error) {
      setError('Failed to generate wallet: ' + error.message);
    }
  };

  const importExistingWallet = () => {
    setStep('import');
  };

  const createWalletFromMnemonic = async () => {
    if (!mnemonic.trim()) {
      setError('Please enter a valid mnemonic phrase');
      return;
    }

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
      // Generate key pair from mnemonic
      const newKeyPair = await mnemonicToKeyPair(mnemonic.trim());
      setKeyPair(newKeyPair);

      // Encrypt and store private key
      const encryptedPrivateKey = encryptPrivateKey(newKeyPair.privateKey, password);
      storeWallet({
        publicKey: newKeyPair.publicKey,
        encryptedPrivateKey,
        publicKeyBase64Der: bytesToBase64(newKeyPair.publicKeyDer)
      });

      // Start onboarding process
      await startOnboarding(newKeyPair);
    } catch (error) {
      setError('Failed to create wallet: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const importWalletFromMnemonic = async () => {
    if (!importMnemonic.trim()) {
      setError('Please enter a valid mnemonic phrase');
      return;
    }

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
      // Generate key pair from mnemonic
      const newKeyPair = await mnemonicToKeyPair(importMnemonic.trim());
      setKeyPair(newKeyPair);

      // Encrypt and store private key
      const encryptedPrivateKey = encryptPrivateKey(newKeyPair.privateKey, password);
      storeWallet({
        publicKey: newKeyPair.publicKey,
        encryptedPrivateKey,
        publicKeyBase64Der: bytesToBase64(newKeyPair.publicKeyDer)
      });

      // Start onboarding process
      await startOnboarding(newKeyPair);
    } catch (error) {
      setError('Failed to import wallet: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const startOnboarding = async (keyPair) => {
    if (onboardingInProgress.current) return;
    onboardingInProgress.current = true;

    try {
      setStep('onboarding');
      setError('');

      // Step 1: Generate onboarding material
      const onboardingResult = await createOnboardingMaterial({
        displayName: 'CLOB Exchange Wallet',
        partyHint: `wallet-${Date.now()}`,
        publicKeyBase64Der: bytesToBase64(keyPair.publicKeyDer)
      });

      setOnboardingData({
        ...onboardingResult,
        keyPair
      });

      setStep('sign');
    } catch (error) {
      setError('Onboarding failed: ' + error.message);
      setStep('create');
    } finally {
      onboardingInProgress.current = false;
    }
  };

  const signAndAllocate = async () => {
    if (!onboardingData || !keyPair) {
      setError('Missing onboarding data');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Sign the multiHash with private key
      const signature = await signMessage(onboardingData.multiHash, keyPair.privateKey);
      const signatureBase64 = bytesToBase64(signature);

      // Step 2: Allocate external party
      const allocationResult = await allocateExternalParty({
        partyId: onboardingData.partyId,
        synchronizerId: onboardingData.synchronizerId,
        onboardingTransactions: onboardingData.topologyTransactions,
        multiHashSignature: {
          format: "SIGNATURE_FORMAT_CONCAT",
          signature: signatureBase64,
          signedBy: onboardingData.publicKeyFingerprint,
          signingAlgorithmSpec: "SIGNING_ALGORITHM_SPEC_ED25519"
        }
      });

      setWalletId(allocationResult.walletId);
      setStep('ready');

      // Auto-unlock for convenience
      await performUnlock(allocationResult.walletId, keyPair);
    } catch (error) {
      setError('Failed to allocate party: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const performUnlock = async (walletIdToUnlock, keyPairToUse) => {
    try {
      // Generate challenge
      const challengeResult = await generateAuthChallenge(walletIdToUnlock);

      // Sign the nonce
      const signature = await signMessage(challengeResult.nonce, keyPairToUse.privateKey);
      const signatureBase64 = bytesToBase64(signature);

      // Unlock wallet
      const unlockResult = await unlockWallet(walletIdToUnlock, challengeResult.nonce, signatureBase64);

      // Store session
      storeSessionToken(walletIdToUnlock, unlockResult.sessionToken);
      setWalletId(walletIdToUnlock);

      if (onWalletReady) {
        onWalletReady({
          walletId: walletIdToUnlock,
          sessionToken: unlockResult.sessionToken,
          keyPair: keyPairToUse
        });
      }
    } catch (error) {
      setError('Failed to unlock wallet: ' + error.message);
    }
  };

  const unlockExistingWallet = async () => {
    if (!unlockPassword) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const wallet = loadWallet();
      if (!wallet) {
        setError('No wallet found. Please create a new wallet.');
        return;
      }

      // Decrypt private key
      const privateKey = decryptPrivateKey(wallet.encryptedPrivateKey, unlockPassword);
      const keyPairToUse = {
        publicKey: wallet.publicKey,
        privateKey,
        publicKeyDer: wallet.publicKeyDer
      };

      // Generate key pair from stored data
      const { publicKeyBase64Der } = wallet;
      
      // Get onboarding material (we need to recreate this)
      const onboardingResult = await createOnboardingMaterial({
        displayName: 'CLOB Exchange Wallet',
        partyHint: `wallet-${Date.now()}`,
        publicKeyBase64Der
      });

      // Sign and allocate
      const signature = await signMessage(onboardingResult.multiHash, privateKey);
      const signatureBase64 = bytesToBase64(signature);

      const allocationResult = await allocateExternalParty({
        partyId: onboardingResult.partyId,
        synchronizerId: onboardingResult.synchronizerId,
        onboardingTransactions: onboardingResult.topologyTransactions,
        multiHashSignature: {
          format: "SIGNATURE_FORMAT_CONCAT",
          signature: signatureBase64,
          signedBy: onboardingResult.publicKeyFingerprint,
          signingAlgorithmSpec: "SIGNING_ALGORITHM_SPEC_ED25519"
        }
      });

      setWalletId(allocationResult.walletId);
      await performUnlock(allocationResult.walletId, keyPairToUse);
      setStep('ready');
    } catch (error) {
      setError('Failed to unlock wallet: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyWalletId = () => {
    navigator.clipboard.writeText(walletId);
    setCopiedWalletId(true);
    setTimeout(() => setCopiedWalletId(false), 2000);
  };

  const goToTrading = () => {
    navigate('/trading');
  };

  // Render different steps
  if (step === 'select') {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6 text-center">CLOB Exchange Wallet</h2>
        
        <div className="space-y-4">
          <button
            onClick={generateNewWallet}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create New Wallet
          </button>
          
          <button
            onClick={importExistingWallet}
            className="w-full py-3 px-4 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Import Existing Wallet
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (step === 'create' || step === 'import') {
    const isImport = step === 'import';
    const currentMnemonic = isImport ? importMnemonic : mnemonic;
    const setMnemonicFn = isImport ? setImportMnemonic : setMnemonic;

    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6">
          {isImport ? 'Import Wallet' : 'Create New Wallet'}
        </h2>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            Recovery Phrase
          </label>
          <textarea
            value={currentMnemonic}
            onChange={(e) => setMnemonicFn(e.target.value)}
            placeholder="Enter your 12-word recovery phrase"
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
        </div>

        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="Create a strong password"
        />

        <PasswordInput
          label="Confirm Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Confirm your password"
        />

        <div className="flex space-x-3 mt-6">
          <button
            onClick={() => setStep('select')}
            className="flex-1 py-2 px-4 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
          >
            Back
          </button>
          <button
            onClick={isImport ? importWalletFromMnemonic : createWalletFromMnemonic}
            disabled={loading}
            className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : (isImport ? 'Import' : 'Create')}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (step === 'unlock') {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6">Unlock Wallet</h2>

        <PasswordInput
          label="Password"
          value={unlockPassword}
          onChange={setUnlockPassword}
          placeholder="Enter your wallet password"
        />

        <button
          onClick={unlockExistingWallet}
          disabled={loading}
          className="w-full mt-6 py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (step === 'onboarding') {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6">Creating Wallet...</h2>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Setting up your external party on Canton...</p>
        </div>
      </div>
    );
  }

  if (step === 'sign') {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6">Sign Onboarding</h2>
        
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          <p className="text-sm">
            Please sign the onboarding transaction to create your external party on Canton.
            This proves you control the private key.
          </p>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600">
            <strong>Wallet ID:</strong> {onboardingData?.walletId}
          </p>
        </div>

        <button
          onClick={signAndAllocate}
          disabled={loading}
          className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Signing...' : 'Sign & Create Wallet'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (step === 'ready') {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6 text-center text-green-600">
          ✅ Wallet Ready!
        </h2>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium mb-2">Your Wallet ID:</p>
          <div className="flex items-center space-x-2">
            <code className="flex-1 text-xs bg-white p-2 rounded border break-all">
              {walletId}
            </code>
            <button
              onClick={copyWalletId}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              {copiedWalletId ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            <strong>Important:</strong> Save your recovery phrase securely.
            You'll need it to restore your wallet on other devices.
          </p>
        </div>

        <button
          onClick={goToTrading}
          className="w-full py-3 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Go to Trading
        </button>
      </div>
    );
  }

  return null;
}
