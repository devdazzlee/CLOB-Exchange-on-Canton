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
import { clearStoredSession } from './services/walletService';
import authService from './services/authService';
import { getOrCreateUserId } from './services/userId';
import './index.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

async function rehydrateUserMapping(partyId, wallet) {
  if (!partyId || !wallet?.publicKey) return;

  const publicKeyBase64 = bytesToBase64(wallet.publicKey);

  // Include signing key if cached in sessionStorage (set after PIN entry).
  // This ensures the backend has the key for interactive settlement
  // even if the user just refreshed the page within the same session.
  let signingKeyBase64 = null;
  try { signingKeyBase64 = sessionStorage.getItem('canton_signing_key_b64'); } catch (_) {}
  const publicKeyFingerprint = localStorage.getItem('canton_key_fingerprint') || '';

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
        ...(signingKeyBase64 ? { signingKeyBase64, publicKeyFingerprint } : {}),
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const wallet = loadWallet();
    if (wallet) {
      const storedPartyId = localStorage.getItem('canton_party_id');
      if (storedPartyId) {
        setPartyId(storedPartyId);
        setWalletReady(true);
        rehydrateUserMapping(storedPartyId, wallet);
      }
    }
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
    // Clear ALL wallet + auth + session data so a fresh wallet can be created
    clearWallet();                           // canton_wallet (localStorage + IndexedDB)
    clearStoredSession();                    // canton_wallet_id, canton_session_token
    authService.logout().catch(() => {});    // clob_access_token, clob_refresh_token, etc.
    localStorage.removeItem('canton_party_id');
    localStorage.removeItem('canton_key_fingerprint');
    // Legacy keys used by apiClient interceptors
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('partyId');
    try { sessionStorage.removeItem('canton_signing_key_b64'); } catch (_) {}
    // Reset all state
    setPartyId(null);
    setWalletReady(false);
    // Force redirect to home page
    window.location.href = '/';
  };

  return (
    <ToastProvider>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="h-screen flex flex-col bg-[#0d1117] overflow-hidden">
        {/* Header */}
        <header className="bg-[#0b0e11] border-b border-[#1e2329] sticky top-0 z-50">
          <div className="px-4">
            <div className="flex items-center justify-between h-14">
              {/* Left: Logo */}
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                    <path d="M2 17L12 22L22 17" />
                    <path d="M2 12L12 17L22 12" />
                  </svg>
                </div>
                <h1 className="text-xl font-bold text-white tracking-tight">
                  Cardiv
                </h1>
              </div>

              {/* Right side */}
              <div className="flex items-center space-x-4">
                {partyId && (
                  <div className="hidden md:flex items-center bg-[#1e2329] rounded-lg px-3 py-1.5 border border-[#2B3139] space-x-3">
                    <span className="text-[#848E9C] text-xs font-medium">Party ID:</span>
                    <code className="text-primary font-mono text-xs max-w-[180px] truncate">
                      {partyId}
                    </code>
                    <button
                      onClick={handleCopyPartyId}
                      className="p-1 hover:bg-[#2B3139] rounded transition-colors"
                      title={copiedPartyId ? "Copied!" : "Copy Party ID"}
                    >
                      {copiedPartyId ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-[#848E9C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012-2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

                {walletReady && (
                  <button
                    onClick={handleLogout}
                    className="flex items-center space-x-2 text-[#848E9C] hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-transparent hover:border-[#2B3139] text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Logout</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>


        {/* Mobile Sidebar Overlay */}
        <div
          className={`md:hidden fixed inset-0 z-[100] transition-opacity duration-300 ${
            sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Sidebar panel */}
          <div
            className={`absolute right-0 top-0 h-full w-72 bg-[#181A20] border-l border-[#2B3139] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
              sidebarOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-[#2B3139]">
              <div className="flex items-center space-x-2">
                <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="28" height="28" rx="6" fill="#6C5CE7"/>
                  <path d="M8 14L13 9L18 14L13 19L8 14Z" fill="white" fillOpacity="0.9"/>
                  <path d="M13 14L18 9L23 14L18 19L13 14Z" fill="white" fillOpacity="0.5"/>
                </svg>
                <span className="text-base font-bold text-white">Cardiv</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 hover:bg-[#2B3139] rounded-md transition-colors text-[#848E9C] hover:text-[#EAECEF]"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* Party ID section */}
              {partyId && (
                <div className="space-y-2">
                  <label className="text-[#848E9C] text-xs font-medium uppercase tracking-wider">Party ID</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 px-3 py-2 bg-[#1E2329] border border-[#2B3139] rounded-md text-[#F0B90B] font-mono text-[11px] break-all leading-relaxed">
                      {partyId}
                    </code>
                  </div>
                  <button
                    onClick={handleCopyPartyId}
                    className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 bg-[#1E2329] hover:bg-[#2B3139] border border-[#2B3139] hover:border-[#F0B90B] rounded-md transition-colors group"
                  >
                    {copiedPartyId ? (
                      <>
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-green-500 text-sm font-medium">Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 text-[#848E9C] group-hover:text-[#F0B90B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012-2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[#848E9C] group-hover:text-[#F0B90B] text-sm font-medium transition-colors">Copy Party ID</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Divider */}
              {partyId && <div className="border-t border-[#2B3139]" />}

              {/* Wallet status */}
              {walletReady && (
                <div className="space-y-1">
                  <label className="text-[#848E9C] text-xs font-medium uppercase tracking-wider">Account</label>
                  <div className="flex items-center space-x-3 px-3 py-2.5 rounded-md bg-[#1E2329] border border-[#2B3139]">
                    <div className="w-8 h-8 bg-[#F0B90B]/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-[#F0B90B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[#EAECEF] text-sm font-medium">Wallet Connected</p>
                      <p className="text-[#848E9C] text-xs truncate">Active session</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar footer: Logout */}
            {walletReady && (
              <div className="px-4 py-4 border-t border-[#2B3139]">
                <button
                  onClick={() => {
                    setSidebarOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-colors group"
                >
                  <svg className="w-5 h-5 text-red-400 group-hover:text-red-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span className="text-red-400 group-hover:text-red-300 font-medium transition-colors">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route
              path="/"
              element={
                walletReady ? (
                  <Navigate to="/trading" replace />
                ) : (
                  <div className="max-w-2xl mx-auto px-4 py-12">
                    <div className="text-center mb-10">
                      <div className="flex items-center justify-center space-x-3 mb-4">
                        <svg className="w-10 h-10" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect width="28" height="28" rx="6" fill="#6C5CE7"/>
                          <path d="M8 14L13 9L18 14L13 19L8 14Z" fill="white" fillOpacity="0.9"/>
                          <path d="M13 14L18 9L23 14L18 19L13 14Z" fill="white" fillOpacity="0.5"/>
                        </svg>
                        <h2 className="text-4xl font-bold text-white">
                          Cardiv
                        </h2>
                      </div>
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

      </div>
    </Router>
    </ToastProvider>
  );
}

export default App;
