import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import WalletSetup from './components/WalletSetup';
import TradingInterface from './components/TradingInterface';
import { loadWallet, publicKeyToPartyId } from './wallet/keyManager';
import './App.css';

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
      <div className="app">
        <header className="app-header">
          <h1>CLOB Exchange on Canton</h1>
          {partyId && (
            <div className="party-info">
              <span>Party ID: </span>
              <code>{partyId.substring(0, 50)}...</code>
            </div>
          )}
        </header>

        <main className="app-main">
          <Routes>
            <Route
              path="/"
              element={
                walletReady ? (
                  <Navigate to="/trading" replace />
                ) : (
                  <div className="home-page">
                    <h2>Welcome to CLOB Exchange</h2>
                    <p>Please set up your wallet to start trading.</p>
                    <WalletSetup onWalletReady={handleWalletReady} />
                  </div>
                )
              }
            />
            <Route
              path="/wallet"
              element={
                <WalletSetup onWalletReady={handleWalletReady} />
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

        <footer className="app-footer">
          <p>CLOB Exchange - Milestone 1 | Canton Devnet</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;

