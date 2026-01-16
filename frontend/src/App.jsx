import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import WalletSetup from './components/WalletSetup';
import TradingInterface from './components/TradingInterface';
import AdminPanel from './components/AdminPanel';
import AuthGuard from './components/AuthGuard';
import AuthCallback from './components/AuthCallback';
import { loadWallet, clearWallet } from './wallet/keyManager';
import { logout, isAuthenticated } from './services/keycloakAuth';
import './index.css';

function App() {
  const [partyId, setPartyId] = useState(null);
  const [walletReady, setWalletReady] = useState(false);
  const [copiedPartyId, setCopiedPartyId] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    // Check if user explicitly logged out - don't load wallet
    const userLoggedOut = sessionStorage.getItem('user_logged_out');
    if (userLoggedOut === 'true') {
      console.log('[App] User logged out, skipping wallet load');
      sessionStorage.removeItem('user_logged_out');
      setWalletReady(false);
      setPartyId(null);
      setAuthenticated(false);
      return;
    }
    
    // Check if wallet exists
    const wallet = loadWallet();
    if (wallet) {
      // IMPORTANT:
      // The real party id is allocated by Canton and returned by our backend.
      // On refresh we must reuse that value, not re-derive a fake partyId from the public key.
      const storedPartyId = localStorage.getItem('canton_party_id');
      if (storedPartyId) {
        setPartyId(storedPartyId);
        setWalletReady(true);
      } else {
        // No fallback: force party registration via backend (WalletSetup will do it)
        setPartyId(null);
        setWalletReady(false);
      }
    }
    
    // Check authentication status
    setAuthenticated(isAuthenticated());
    
    // Listen for auth token changes
    const handleAuthChange = () => {
      setAuthenticated(isAuthenticated());
    };
    
    window.addEventListener('auth-token-stored', handleAuthChange);
    
    return () => {
      window.removeEventListener('auth-token-stored', handleAuthChange);
    };
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
    // Clear all authentication and wallet data
    clearWallet();
    localStorage.removeItem('canton_party_id');
    logout();
    // Reset all state
    setPartyId(null);
    setWalletReady(false);
    setAuthenticated(false);
    // Force redirect to home page
    window.location.href = '/';
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
              <div className="flex items-center space-x-3">
                {partyId && (
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="hidden sm:inline text-[#848E9C]">Party ID:</span>
                    <code className="px-2 sm:px-3 py-1.5 bg-[#1E2329] border border-[#2B3139] rounded-md text-[#F0B90B] font-mono text-xs max-w-[100px] sm:max-w-[200px] md:max-w-none truncate">
                      <span className="hidden sm:inline">{partyId.substring(0, 30)}...</span>
                      <span className="sm:hidden">{partyId.substring(0, 12)}...</span>
                    </code>
                    <button
                      onClick={handleCopyPartyId}
                      className="p-1.5 sm:p-2 hover:bg-[#2B3139] rounded-md transition-colors group border border-[#2B3139] hover:border-[#F0B90B]"
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
                  </div>
                )}
                {authenticated && (
                  <button
                    onClick={handleLogout}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-md border border-red-500/50 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:border-red-500 hover:text-red-300 transition-colors flex items-center space-x-1.5"
                    title="Logout"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Token Manager - Simple token input */}
          {/* <TokenManager /> */}
          
          <Routes>
            <Route
              path="/auth/callback"
              element={<AuthCallback />}
            />
            <Route
              path="/"
              element={
                walletReady && authenticated ? (
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
                <AuthGuard>
                  <TradingInterface partyId={partyId} />
                </AuthGuard>
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
  );
}

export default App;
