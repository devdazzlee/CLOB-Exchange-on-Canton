import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { handleAuthCallback } from '../services/keycloakAuth';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(`Authentication failed: ${errorParam}`);
      setLoading(false);
      return;
    }

    if (!code) {
      setError('No authorization code received');
      setLoading(false);
      return;
    }

    // Add timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      setError('Authentication timed out. Please try again.');
      setLoading(false);
    }, 10000); // 10 seconds timeout

    // Exchange code for tokens
    console.log('[AuthCallback] Starting token exchange with code:', code);
    handleAuthCallback(code)
      .then(() => {
        clearTimeout(timeout);
        console.log('[AuthCallback] Token exchange successful');
        // Redirect to trading page or previous location
        const returnTo = sessionStorage.getItem('auth_return_to') || '/trading';
        sessionStorage.removeItem('auth_return_to');
        console.log('[AuthCallback] Redirecting to:', returnTo);
        navigate(returnTo);
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.error('[AuthCallback] Error:', err);
        setError(err.message || 'Authentication failed');
        setLoading(false);
      });
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-[#EAECEF]">Completing authentication...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="card max-w-md">
          <div className="text-center">
            <svg className="w-16 h-16 text-danger mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-xl font-bold text-[#EAECEF] mb-2">Authentication Failed</h2>
            <p className="text-[#848E9C] mb-6">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="btn btn-primary"
            >
              Go to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}




