import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isAuthenticated, getValidAccessToken } from '../services/keycloakAuth';
import { loadWallet } from '../wallet/keyManager';
import { createPartyForUser } from '../services/partyService';
import { storeTokens } from '../services/keycloakAuth';

export default function AuthGuard({ children }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuth, setIsAuth] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    console.log('[AuthGuard] Starting auth check');
    try {
      // Check if user is authenticated
      const authStatus = isAuthenticated();
      console.log('[AuthGuard] isAuthenticated result:', authStatus);
      
      if (authStatus) {
        console.log('[AuthGuard] User appears authenticated, verifying token...');
        // Verify token is still valid
        try {
          const token = await getValidAccessToken();
          console.log('[AuthGuard] Token validation successful');
          setIsAuth(true);
          setIsChecking(false);
          return;
        } catch (error) {
          // Token refresh failed, but check if we have a wallet
          console.log('[AuthGuard] Token refresh failed, checking for wallet:', error.message);
        }
      }

      // Not authenticated - check if user has a wallet
      console.log('[AuthGuard] User not authenticated, checking for wallet...');
      const wallet = loadWallet();
      
      if (wallet && wallet.publicKey) {
        // User has wallet but no token - try to create party and get token
        console.log('[AuthGuard] Wallet found, creating party on backend...');
        try {
          const partyResult = await createPartyForUser(wallet.publicKey);
          
          // If backend provided a token, store it
          if (partyResult.token) {
            console.log('[AuthGuard] Storing authentication token from backend...');
            storeTokens(partyResult.token, null, 1800);
            setIsAuth(true);
            setIsChecking(false);
            return;
          } else {
            // Party created but no token - this is okay, user can still proceed
            // The token might be generated later or user might need to authenticate differently
            console.warn('[AuthGuard] Party created but no token provided. Proceeding anyway.');
            setIsAuth(true);
            setIsChecking(false);
            return;
          }
        } catch (partyError) {
          console.error('[AuthGuard] Error creating party:', partyError);
          // If quota exceeded or other error, show error message
          if (partyError.message.includes('quota')) {
            setError('Daily or weekly quota for new wallets has been exceeded. Please try again later.');
          } else {
            setError(`Failed to create party: ${partyError.message}`);
          }
          setIsChecking(false);
          return;
        }
      }

      // No wallet and no token - redirect to wallet setup
      console.log('[AuthGuard] No wallet found, redirecting to wallet setup');
      navigate('/');
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


