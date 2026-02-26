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
            <div className="flex items-center justify-between h-14 sm:h-16">
              {/* Left: Logo */}
              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#F0B90B] rounded-md flex items-center justify-center font-bold text-[#0B0E11] text-sm sm:text-lg shadow-lg flex-shrink-0">
                  C
                </div>
                <h1 className="text-base sm:text-xl font-bold text-[#EAECEF] whitespace-nowrap">
                  CLOB Exchange
                </h1>
              </div>

              {/* Right side */}
              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                {/* Desktop: Full Party ID with copy button */}
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

                {/* Desktop: Logout button */}
                {walletReady && (
                  <button
                    onClick={handleLogout}
                    className="hidden md:flex text-[#848E9C] hover:text-[#EAECEF] transition-colors items-center space-x-2 flex-shrink-0 text-base"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Logout</span>
                  </button>
                )}

                {/* Mobile: Compact Wallet ID */}
                {partyId && (
                  <div className="md:hidden flex items-center min-w-0">
                    <code className="px-2 py-1 bg-[#1E2329] border border-[#2B3139] rounded text-[#F0B90B] font-mono text-[10px] truncate max-w-[120px]">
                      {partyId.substring(0, 12)}...
                    </code>
                  </div>
                )}

                {/* Mobile: Hamburger menu button */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden p-2 hover:bg-[#2B3139] rounded-md transition-colors text-[#848E9C] hover:text-[#EAECEF] flex-shrink-0"
                  aria-label="Open menu"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
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
                <div className="w-8 h-8 bg-[#F0B90B] rounded-md flex items-center justify-center font-bold text-[#0B0E11] text-sm shadow-lg">
                  C
                </div>
                <span className="text-base font-bold text-[#EAECEF]">Menu</span>
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
        <main className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-4 sm:py-8">
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
        <footer className="relative bg-gradient-to-b from-[#181A20] to-[#0B0E11] border-t border-[#2B3139]/60 mt-12 overflow-hidden">
          {/* Animated gradient accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#F0B90B] to-transparent animate-pulse" />
          
          {/* Subtle background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#F0B90B]/[0.03] rounded-full blur-3xl pointer-events-none" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            {/* Main Footer Content */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-6 mb-8">
              
              {/* Brand */}
              <div className="sm:col-span-2 lg:col-span-1 space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-[#F0B90B] to-[#d4a50a] rounded-lg flex items-center justify-center font-bold text-[#0B0E11] text-base shadow-lg shadow-[#F0B90B]/20">
                    C
                  </div>
                  <span className="text-lg font-bold text-[#EAECEF]">CLOB Exchange</span>
                </div>
                <p className="text-[#848E9C] text-sm leading-relaxed max-w-xs">
                  A decentralized Central Limit Order Book exchange built on Canton Network with DAML smart contracts.
                </p>
              </div>

              {/* Technology */}
              <div className="space-y-3">
                <h4 className="text-[#EAECEF] font-semibold text-sm uppercase tracking-wider">Technology</h4>
                <ul className="space-y-2">
                  {['Canton Network', 'DAML Smart Contracts', 'React Frontend', 'Real-time Trading'].map((item) => (
                    <li key={item} className="text-[#848E9C] text-sm hover:text-[#F0B90B] transition-colors cursor-default flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-[#F0B90B]/50" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Features */}
              <div className="space-y-3">
                <h4 className="text-[#EAECEF] font-semibold text-sm uppercase tracking-wider">Features</h4>
                <ul className="space-y-2">
                  {['Limit & Market Orders', 'Stop-Loss Orders', 'Order Book Matching', 'Portfolio Tracking'].map((item) => (
                    <li key={item} className="text-[#848E9C] text-sm hover:text-[#F0B90B] transition-colors cursor-default flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-[#F0B90B]/50" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Stats / Info */}
              <div className="space-y-3">
                <h4 className="text-[#EAECEF] font-semibold text-sm uppercase tracking-wider">Platform</h4>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[#848E9C] text-sm">Network Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#F0B90B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-[#848E9C] text-sm">Secured by DAML</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#F0B90B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-[#848E9C] text-sm">Low Latency</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[#2B3139]/60 pt-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-[#5E6673] text-xs sm:text-sm text-center sm:text-left">
                  © {new Date().getFullYear()} CLOB Exchange on Canton • Powered by DAML Smart Contracts
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-[#5E6673] text-xs px-2.5 py-1 rounded-full border border-[#2B3139]/60 bg-[#1E2329]/50">
                    v1.0
                  </span>
                  <span className="text-[#5E6673] text-xs px-2.5 py-1 rounded-full border border-[#2B3139]/60 bg-[#1E2329]/50 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[#F0B90B] rounded-full" />
                    Canton
                  </span>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </Router>
    </ToastProvider>
  );
}

export default App;
