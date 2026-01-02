import { useState, useEffect } from 'react';
import { getStoredToken, getTokenExpirationString, isTokenExpired, checkTokenStatus } from '../services/tokenManager';
import { useConfirmationModal } from './ConfirmationModal';
import Login from './Login';

export default function TokenManager() {
  const [token, setToken] = useState('');
  const [expirationInfo, setExpirationInfo] = useState('');
  const [showLogin, setShowLogin] = useState(false);
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
    updateTokenInfo();
    // Check token status every minute
    const interval = setInterval(updateTokenInfo, 60000);
    return () => clearInterval(interval);
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
  };

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
