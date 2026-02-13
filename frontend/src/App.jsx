import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import WalletSetup from './components/WalletSetup';
import TradingInterface from './components/TradingInterface';
import TradingTest from './components/TradingTest';
import AdminPanel from './components/AdminPanel';
import AuthGuard from './components/AuthGuard';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/toast';
import { loadWallet, clearWallet, bytesToBase64 } from './wallet/keyManager';
import { getOrCreateUserId } from './services/userId';
import './index.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

async function rehydrateUserMapping(partyId, wallet) {
  if (!partyId || !wallet?.publicKey) return;

  const publicKeyBase64 = bytesToBase64(wallet.publicKey);

  try {
    await fetch(`${API_BASE_URL}/onboarding/rehydrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': getOrCreateUserId(),
      },
      body: JSON.stringify({
        partyId,
        publicKeyBase64,
      }),
    });
  } catch (error) {
    console.warn('[App] Failed to rehydrate user mapping:', error);
  }
}

function App() {
  const [partyId, setPartyId] = useState(null);
  const [walletReady, setWalletReady] = useState(false);
  const [copiedPartyId, setCopiedPartyId] = useState(false);

  useEffect(() => {
    // Check if wallet exists
    const wallet = loadWallet();
    if (wallet) {
      // IMPORTANT:
      // The real party id is allocated by Canton and returned by our backend.
      // On refresh we must reuse that value, not re-derive a fake partyId from the public key.
      const storedPartyId = localStorage.getItem('canton_party_id');
      if (storedPartyId) {
        setPartyId(storedPartyId);
        Promise.resolve(rehydrateUserMapping(storedPartyId, wallet))
          .finally(() => setWalletReady(true));
      } else {
        // No fallback: force party registration via backend (WalletSetup will do it)
        setPartyId(null);
        setWalletReady(false);
      }
    }
    
    // No Keycloak auth for end users. Wallet presence is the only gating signal.
  }, []);

  const handleWalletReady = (newPartyId) => {
    setPartyId(newPartyId);
    setWalletReady(true);
    // Note: Navigation will happen automatically via React Router
    // when walletReady and authenticated are both true
  };

  const handleCopyPartyId = async () => {
    try {
      await navigator.clipboard.writeText(partyId);
      setCopiedPartyId(true);
      setTimeout(() => setCopiedPartyId(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy Party ID:', err);
    }
  };

  const handleLogout = () => {
    // Clear wallet + onboarding identity (frontend-side)
    clearWallet();
    localStorage.removeItem('canton_party_id');
    // Reset all state
    setPartyId(null);
    setWalletReady(false);
    // Force redirect to home page
    window.location.href = '/';
  };

  return (
    <ToastProvider>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-[#0B0E11]">
        {/* Header */}
        <header className="bg-[#181A20] border-b border-[#2B3139] sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            {/* Top row: Logo + Actions */}
            <div className="flex items-center justify-between h-14 sm:h-16">
              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#F0B90B] rounded-md flex items-center justify-center font-bold text-[#0B0E11] text-sm sm:text-lg shadow-lg flex-shrink-0">
                  C
                </div>
                <h1 className="text-base sm:text-xl font-bold text-[#EAECEF] whitespace-nowrap">
                  CLOB Exchange
                </h1>
              </div>
              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                {/* Party ID - hidden on very small screens, shown inline on md+ */}
                {partyId && (
                  <div className="hidden md:flex items-center space-x-2 text-sm">
                    <span className="text-[#848E9C]">Party ID:</span>
                    <code className="px-3 py-1.5 bg-[#1E2329] border border-[#2B3139] rounded-md text-[#F0B90B] font-mono text-xs truncate max-w-[200px] lg:max-w-none">
                      {partyId.substring(0, 30)}...
                    </code>
                    <button
                      onClick={handleCopyPartyId}
                      className="p-2 hover:bg-[#2B3139] rounded-md transition-colors group border border-[#2B3139] hover:border-[#F0B90B] flex-shrink-0"
                      title={copiedPartyId ? "Copied!" : "Copy Party ID"}
                    >
                      {copiedPartyId ? (
                        <svg className="w-4 h-4 text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-[#848E9C] group-hover:text-[#F0B90B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012-2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                {/* Mobile: compact copy button only */}
                {partyId && (
                  <button
                    onClick={handleCopyPartyId}
                    className="md:hidden p-2 hover:bg-[#2B3139] rounded-md transition-colors group border border-[#2B3139] hover:border-[#F0B90B] flex-shrink-0"
                    title={copiedPartyId ? "Copied!" : "Copy Party ID"}
                  >
                    {copiedPartyId ? (
                      <svg className="w-4 h-4 text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-[#848E9C] group-hover:text-[#F0B90B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                )}
                {walletReady && (
                  <button
                    onClick={handleLogout}
                    className="text-[#848E9C] hover:text-[#EAECEF] transition-colors flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0 text-sm sm:text-base"
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                )}
              </div>
            </div>
            {/* Mobile Party ID row - shown below header on small screens */}
            {partyId && (
              <div className="md:hidden flex items-center space-x-2 pb-2.5 -mt-1">
                <span className="text-[#848E9C] text-xs flex-shrink-0">Party ID:</span>
                <code className="px-2 py-1 bg-[#1E2329] border border-[#2B3139] rounded text-[#F0B90B] font-mono text-[10px] sm:text-xs truncate min-w-0">
                  {partyId.substring(0, 20)}...
                </code>
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Token Manager - Simple token input */}
          {/* <TokenManager /> */}
          
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
                  <ErrorBoundary>
                    <TradingInterface partyId={partyId} />
                  </ErrorBoundary>
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/trading-test"
              element={
                walletReady ? (
                  <ErrorBoundary>
                    <TradingTest partyId={partyId} />
                  </ErrorBoundary>
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/admin"
              element={
                <AuthGuard>
                  <AdminPanel partyId={partyId} />
                </AuthGuard>
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
    </ToastProvider>
  );
}

export default App;
