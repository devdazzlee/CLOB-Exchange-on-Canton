import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import WalletSetup from './components/WalletSetup';
import TradingInterface from './components/TradingInterface';
import TokenManager from './components/TokenManager';
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
      <div className="min-h-screen bg-[#0B0E11]">
        {/* Header */}
        <header className="bg-[#181A20] border-b border-[#2B3139] sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-[#F0B90B] rounded-md flex items-center justify-center font-bold text-[#0B0E11] text-lg shadow-lg">
                  C
                </div>
                <h1 className="text-xl font-bold text-[#EAECEF]">
                  CLOB Exchange
                </h1>
              </div>
              {partyId && (
                <div className="hidden md:flex items-center space-x-2 text-sm">
                  <span className="text-[#848E9C]">Party ID:</span>
                  <code className="px-3 py-1.5 bg-[#1E2329] border border-[#2B3139] rounded-md text-[#F0B90B] font-mono text-xs">
                    {partyId.substring(0, 30)}...
                  </code>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Token Manager - Show on all pages */}
          <TokenManager />
          
          <Routes>
            <Route
              path="/"
              element={
                walletReady ? (
                  <Navigate to="/trading" replace />
                ) : (
                  <div className="max-w-2xl mx-auto">
                    <div className="text-center mb-10">
                      <h2 className="text-4xl font-bold text-[#EAECEF] mb-3">
                        Welcome to CLOB Exchange
                      </h2>
                      <p className="text-[#848E9C] text-lg">
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
        <footer className="bg-[#181A20] border-t border-[#2B3139] mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-center text-[#848E9C] text-sm">
              CLOB Exchange on Canton • Powered by DAML Smart Contracts
            </p>
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
