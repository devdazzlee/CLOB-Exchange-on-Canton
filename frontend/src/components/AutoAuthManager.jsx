import { useState, useEffect } from 'react';
import { isAuthenticated, getValidAccessToken, loginWithPassword, logout, storeManualToken } from '../services/keycloakAuth';
import { useConfirmationModal } from './ConfirmationModal';

/**
 * Professional Authentication Manager
 * Automatically handles OAuth login, token refresh, and authentication status
 * No manual token input needed - seamless user experience
 */
export default function AutoAuthManager() {
  const [isAuth, setIsAuth] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const { showModal, ModalComponent } = useConfirmationModal();

  useEffect(() => {
    checkAuthStatus();
    // Check auth status every 30 seconds
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh token before expiration
  useEffect(() => {
    if (!isAuth) return;

    const refreshInterval = setInterval(async () => {
      try {
        // This will automatically refresh if needed
        await getValidAccessToken();
        checkAuthStatus();
      } catch (error) {
        console.error('[AutoAuth] Token refresh failed:', error);
        setIsAuth(false);
      }
    }, 60000); // Check every minute

    return () => clearInterval(refreshInterval);
  }, [isAuth]);

  const checkAuthStatus = async () => {
    try {
      if (isAuthenticated()) {
        // Verify token is still valid
        try {
          const token = await getValidAccessToken();
          setIsAuth(true);
          
          // Parse token to get expiry
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              if (payload.exp) {
                const expiryDate = new Date(payload.exp * 1000);
                setTokenExpiry(expiryDate);
              }
            }
          } catch (e) {
            // Ignore parsing errors
          }
        } catch (error) {
          setIsAuth(false);
          setTokenExpiry(null);
        }
      } else {
        setIsAuth(false);
        setTokenExpiry(null);
      }
    } catch (error) {
      console.error('[AutoAuth] Auth check error:', error);
      setIsAuth(false);
      setTokenExpiry(null);
    } finally {
      setIsChecking(false);
    }
  };

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = () => {
    // Use password grant flow directly (no redirect URI needed)
    // This is more reliable and doesn't require Keycloak configuration
    setShowLoginModal(true);
  };

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      await loginWithPassword(username, password);
      setShowLoginModal(false);
      setUsername('');
      setPassword('');
      await checkAuthStatus();
    } catch (error) {
      const errorMsg = error.message || 'Login failed. Please check your credentials.';
      setLoginError(errorMsg);
      
      // If password grant not supported, offer manual token option
      if (errorMsg.includes('Password grant not supported')) {
        setTimeout(() => {
          setShowLoginModal(false);
          setShowTokenModal(true);
        }, 3000);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTokenLogin = () => {
    if (!tokenInput.trim()) {
      setLoginError('Please enter a token');
      return;
    }

    try {
      storeManualToken(tokenInput.trim());
      setShowTokenModal(false);
      setTokenInput('');
      setLoginError('');
      checkAuthStatus();
    } catch (error) {
      setLoginError('Invalid token format');
    }
  };

  const handleLogout = async () => {
    const confirmed = await showModal({
      title: 'Logout',
      message: 'Are you sure you want to logout?',
      type: 'warning',
      showCancel: true,
      confirmText: 'Logout',
      cancelText: 'Cancel',
    });

    if (confirmed) {
      logout();
      setIsAuth(false);
      setTokenExpiry(null);
    }
  };

  const getExpiryString = () => {
    if (!tokenExpiry) return '';
    const now = new Date();
    const minutesLeft = Math.floor((tokenExpiry - now) / 60000);
    if (minutesLeft < 0) return 'Expired';
    if (minutesLeft < 60) return `${minutesLeft}m`;
    const hoursLeft = Math.floor(minutesLeft / 60);
    return `${hoursLeft}h`;
  };

  // Show loading state
  if (isChecking) {
    return (
      <>
        <ModalComponent />
        <div className="bg-[#1E2329] border border-[#2B3139] rounded-lg p-3 mb-4">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            <span className="text-[#848E9C] text-sm">Checking authentication...</span>
          </div>
        </div>
      </>
    );
  }

  // Not authenticated - show login button
  if (!isAuth) {
    return (
      <>
        <ModalComponent />
        <div className="bg-[#F0B90B15] border border-primary rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <span className="font-semibold text-[#EAECEF]">Authentication Required</span>
                <p className="text-sm text-[#848E9C]">Please login to access the exchange</p>
              </div>
            </div>
            <button
              onClick={handleLogin}
              className="btn btn-primary"
            >
              Login
            </button>
          </div>
        </div>

        {/* Login Modal */}
        {showLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 backdrop-blur-sm">
            <div className="bg-[#181A20] rounded-lg shadow-xl p-6 max-w-md w-full border-t-4 border-primary">
              <h3 className="text-xl font-semibold text-[#EAECEF] mb-4">Login to CLOB Exchange</h3>
              
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#848E9C] mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input w-full"
                    placeholder="Enter your username"
                    required
                    autoFocus
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#848E9C] mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input w-full"
                    placeholder="Enter your password"
                    required
                  />
                </div>

                {loginError && (
                  <div className="bg-danger-light border border-danger rounded-lg p-3">
                    <p className="text-danger text-sm">{loginError}</p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLoginModal(false);
                      setLoginError('');
                      setUsername('');
                      setPassword('');
                    }}
                    className="btn btn-secondary flex-1"
                    disabled={isLoggingIn}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary flex-1"
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Logging in...
                      </>
                    ) : (
                      'Login'
                    )}
                  </button>
                </div>
              </form>

              <p className="text-xs text-[#848E9C] mt-4 text-center">
                Default credentials: zoya / Zoya123!
              </p>
              
              <div className="mt-4 pt-4 border-t border-[#2B3139]">
                <button
                  type="button"
                  onClick={() => {
                    setShowLoginModal(false);
                    setShowTokenModal(true);
                  }}
                  className="text-sm text-primary hover:underline w-full"
                >
                  Or enter token manually
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Token Input Modal */}
        {showTokenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 backdrop-blur-sm">
            <div className="bg-[#181A20] rounded-lg shadow-xl p-6 max-w-md w-full border-t-4 border-primary">
              <h3 className="text-xl font-semibold text-[#EAECEF] mb-4">Enter JWT Token</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#848E9C] mb-2">
                    JWT Token
                  </label>
                  <textarea
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="input w-full resize-none h-32 font-mono text-sm"
                    placeholder="Paste your JWT token here (with or without 'Bearer' prefix)"
                    required
                    autoFocus
                  />
                </div>

                {loginError && (
                  <div className="bg-danger-light border border-danger rounded-lg p-3">
                    <p className="text-danger text-sm">{loginError}</p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTokenModal(false);
                      setLoginError('');
                      setTokenInput('');
                      setShowLoginModal(true);
                    }}
                    className="btn btn-secondary flex-1"
                  >
                    Back to Login
                  </button>
                  <button
                    type="button"
                    onClick={handleTokenLogin}
                    className="btn btn-primary flex-1"
                  >
                    Use Token
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Authenticated - show status
  return (
    <>
      <ModalComponent />
      <div className="bg-[#1E2329] border border-[#2B3139] rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <span className="font-semibold text-success">Authenticated</span>
              {tokenExpiry && (
                <span className="text-sm text-[#848E9C] ml-2">
                  (Expires in {getExpiryString()})
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="btn btn-secondary btn-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}

