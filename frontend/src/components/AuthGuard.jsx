import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadWallet } from '../wallet/keyManager';

export default function AuthGuard({ children }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuth, setIsAuth] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    console.log('[AuthGuard] Starting auth check');
    try {
      // Check if user explicitly logged out - don't auto-authenticate
      const userLoggedOut = sessionStorage.getItem('user_logged_out');
      if (userLoggedOut === 'true') {
        console.log('[AuthGuard] User explicitly logged out, redirecting to home...');
        sessionStorage.removeItem('user_logged_out'); // Clear flag
        navigate('/');
        setIsChecking(false);
        return;
      }
      
      // Check if wallet exists and party ID is stored
      const wallet = loadWallet();
      const partyId = localStorage.getItem('canton_party_id');
      
      // If wallet and party ID exist, allow access (authentication is optional)
      if (wallet && partyId) {
        console.log('[AuthGuard] Wallet and party ID found, allowing access');
        setIsAuth(true);
        setIsChecking(false);
        return;
      }

      // Not authenticated and no wallet - redirect to home
      console.log('[AuthGuard] No wallet or authentication found, redirecting to home...');
      navigate('/');
      setIsChecking(false);
      return;
    } catch (error) {
      console.error('[AuthGuard] Auth check error:', error);
      setError(`Authentication error: ${error.message}`);
      setIsChecking(false);
    }
  };

  // Show loading screen while checking authentication
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold text-[#EAECEF] mb-2">Authenticating...</h2>
          <p className="text-[#848E9C]">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Show error if authentication failed
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="max-w-md mx-auto p-6 bg-[#1E2329] border border-danger rounded-lg">
          <div className="text-center">
            <svg className="w-16 h-16 text-danger mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-2xl font-bold text-[#EAECEF] mb-2">Authentication Error</h2>
            <p className="text-[#848E9C] mb-6">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="btn btn-primary"
            >
              Go to Wallet Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  // User is authenticated, render children
  if (!isAuth) {
    return null; // Will redirect in checkAuth
  }

  return <>{children}</>;
}



