import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import WalletSetup from './components/WalletSetup';
import TradingInterface from './components/TradingInterface';
import { loadWallet, publicKeyToPartyId } from './wallet/keyManager';
import './index.css';

function App() {
  const [partyId, setPartyId] = useState(null);
  const [walletReady, setWalletReady] = useState(false);

  useEffect(() => {
    // Check if wallet exists
    const wallet = loadWallet();
    if (wallet) {
      const derivedPartyId = publicKeyToPartyId(wallet.publicKey);
      setPartyId(derivedPartyId);
      setWalletReady(true);
    }
  }, []);

  const handleWalletReady = (newPartyId) => {
    setPartyId(newPartyId);
    setWalletReady(true);
  };

  return (
    <Router>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        {/* Header */}
        <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-md flex items-center justify-center font-bold text-white text-lg">
                  C
                </div>
                <h1 className="text-xl font-bold text-white">
                  CLOB Exchange
                </h1>
              </div>
              {partyId && (
                <div className="hidden md:flex items-center space-x-2 text-sm">
                  <span className="text-gray-400">Party ID:</span>
                  <code className="px-3 py-1 bg-gray-700 rounded-lg text-blue-400 font-mono text-xs">
                    {partyId.substring(0, 30)}...
                  </code>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route
              path="/"
              element={
                walletReady ? (
                  <Navigate to="/trading" replace />
                ) : (
                  <div className="max-w-2xl mx-auto">
                    <div className="text-center mb-8">
                      <h2 className="text-4xl font-bold text-white mb-4">
                        Welcome to CLOB Exchange
                      </h2>
                      <p className="text-gray-400 text-lg">
                        Decentralized trading on Canton blockchain
                      </p>
                    </div>
                    <WalletSetup onWalletReady={handleWalletReady} />
                  </div>
                )
              }
            />
            <Route
              path="/wallet"
              element={
                <div className="max-w-2xl mx-auto">
                  <WalletSetup onWalletReady={handleWalletReady} />
                </div>
              }
            />
            <Route
              path="/trading"
              element={
                walletReady ? (
                  <TradingInterface partyId={partyId} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-gray-800/50 backdrop-blur-sm border-t border-gray-700 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-center text-gray-400 text-sm">
              CLOB Exchange on Canton • Powered by DAML Smart Contracts
            </p>
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
