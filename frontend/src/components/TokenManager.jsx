import { useState, useEffect } from 'react';
import { getStoredToken, getTokenExpirationString, isTokenExpired, checkTokenStatus } from '../services/tokenManager';
import { useConfirmationModal } from './ConfirmationModal';
import Login from './Login';

export default function TokenManager() {
  const [token, setToken] = useState('');
  const [expirationInfo, setExpirationInfo] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const { showModal, ModalComponent } = useConfirmationModal();

  const handleClearToken = async () => {
    const confirmed = await showModal({
      title: 'Clear Token',
      message: 'Clear stored token? You will need to login again.',
      type: 'warning',
      showCancel: true,
      confirmText: 'Clear',
      cancelText: 'Cancel',
    });
    
    if (confirmed) {
      localStorage.removeItem('canton_jwt_token');
      localStorage.removeItem('canton_jwt_token_expires');
      updateTokenInfo();
    }
  };

  const handleLoginSuccess = (newToken) => {
    setShowLogin(false);
    updateTokenInfo();
  };

  useEffect(() => {
    // Initial check with loading state
    setIsChecking(true);
    updateTokenInfo();
    // Mark checking as complete after initial load
    setTimeout(() => setIsChecking(false), 100);
    
    // Check frequently (every 5 seconds) for immediate updates after login
    const interval = setInterval(updateTokenInfo, 5000);
    
    // Listen for storage changes (when token is stored after OAuth)
    const handleStorageChange = (e) => {
      if (e.key === 'canton_jwt_token' || e.key === 'canton_jwt_token_expires_at') {
        console.log('[TokenManager] Storage change detected, updating token info');
        // Don't show loader for storage changes - just update silently
        updateTokenInfo();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    // Listen for custom auth events (for same-tab updates)
    const handleAuthEvent = () => {
      console.log('[TokenManager] Auth event received, updating token info');
      // Don't show loader for auth events - just update silently
      updateTokenInfo();
    };
    window.addEventListener('auth-token-stored', handleAuthEvent);
    
    // Check when page becomes visible (user returns from OAuth redirect)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('[TokenManager] Page visible, checking token');
        // Show brief loader when returning from OAuth
        setIsChecking(true);
        updateTokenInfo();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Check when window gains focus (user returns from OAuth redirect)
    const handleFocus = () => {
      console.log('[TokenManager] Window focused, checking token');
      // Show brief loader when returning from OAuth
      setIsChecking(true);
      updateTokenInfo();
    };
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('auth-token-stored', handleAuthEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const updateTokenInfo = () => {
    const currentToken = getStoredToken() || import.meta.env.VITE_CANTON_JWT_TOKEN;
    setToken(currentToken || '');
    
    if (currentToken) {
      const info = getTokenExpirationString(currentToken);
      const expired = isTokenExpired(currentToken);
      setExpirationInfo(expired ? 'Expired' : info);
      checkTokenStatus(currentToken);
    } else {
      setExpirationInfo('No token');
    }
    
    // Mark checking as complete after update
    setIsChecking(false);
  };

  // Show loader while checking token status
  if (isChecking) {
    return (
      <>
        <ModalComponent />
        <div className="bg-[#1E2329] border border-[#2B3139] rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
              <span className="text-[#848E9C] font-semibold">Checking authentication...</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  // No token - show login prompt
  if (!token) {
    return (
      <>
        <ModalComponent />
        <div className="bg-danger-light border border-danger rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-danger font-semibold">No authentication token</span>
            </div>
            <button
              onClick={() => setShowLogin(true)}
              className="btn btn-primary btn-sm"
            >
              Login with OAuth
            </button>
          </div>
          {showLogin && (
            <div className="mt-3">
              <Login onLoginSuccess={handleLoginSuccess} />
            </div>
          )}
        </div>
      </>
    );
  }

  // Has token - show token status
  const isExpired = isTokenExpired(token);
  const isExpiringSoon = expirationInfo.includes('minutes') && parseInt(expirationInfo) < 5;

  return (
    <>
      <ModalComponent />
      <div className={`border rounded-lg p-3 mb-4 ${
        isExpired 
          ? 'bg-danger-light border-danger' 
          : isExpiringSoon 
          ? 'bg-[#F0B90B15] border-primary' 
          : 'bg-[#1E2329] border-[#2B3139]'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {isExpired ? (
              <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : isExpiringSoon ? (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div>
            <span className={`font-semibold ${
              isExpired ? 'text-danger' : isExpiringSoon ? 'text-primary' : 'text-success'
            }`}>
              Token {isExpired ? 'Expired' : isExpiringSoon ? 'Expiring Soon' : 'Valid'}
            </span>
            <span className="text-[#848E9C] text-sm ml-2">
              ({expirationInfo})
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleClearToken}
            className="btn btn-danger btn-sm"
          >
            Clear Token
          </button>
        </div>
      </div>
    </>
  );
}
