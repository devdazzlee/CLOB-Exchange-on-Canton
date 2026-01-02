import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isAuthenticated, getValidAccessToken, initiateLogin } from '../services/keycloakAuth';

export default function AuthGuard({ children }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuth, setIsAuth] = useState(false);
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
          // Token refresh failed, need to login again
          console.log('[AuthGuard] Token refresh failed, redirecting to login:', error.message);
        }
      }

      // Not authenticated - redirect to login
      console.log('[AuthGuard] User not authenticated, redirecting to login');
      // Store current location to return after login
      sessionStorage.setItem('auth_return_to', location.pathname);
      initiateLogin();
    } catch (error) {
      console.error('[AuthGuard] Auth check error:', error);
      // On error, redirect to login
      console.log('[AuthGuard] Auth check error, redirecting to login');
      sessionStorage.setItem('auth_return_to', location.pathname);
      initiateLogin();
    }
  };

  // Show loading screen while checking authentication
  if (isChecking || !isAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold text-[#EAECEF] mb-2">Authenticating...</h2>
          <p className="text-[#848E9C]">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // User is authenticated, render children
  return <>{children}</>;
}


