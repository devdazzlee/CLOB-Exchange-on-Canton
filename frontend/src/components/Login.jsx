import { useState } from 'react';
import { initiateLogin } from '../services/keycloakAuth';

export default function Login({ onLoginSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleOAuthLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await initiateLogin();
    } catch (err) {
      if (err.message === 'DEV_REDIRECT_URI_NOT_CONFIGURED') {
        setError(
          'Local development OAuth not configured. Please ask your client to add this redirect URI to Keycloak:\n\n' +
          'http://localhost:3000/auth/callback\n\n' +
          'Or deploy to production to use OAuth.'
        );
      } else {
        setError('OAuth login failed. Please try again.');
      }
      console.error('OAuth login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-[#EAECEF] mb-6">Login to Canton</h2>
      
      {error && (
        <div className="bg-danger-light border border-danger rounded-lg p-4 mb-4">
          <p className="text-danger text-sm whitespace-pre-line">{error}</p>
        </div>
      )}

      {/* OAuth Login */}
      <div className="space-y-4">
        <p className="text-[#848E9C] text-sm">
          Click below to login with OAuth (redirects to Keycloak)
        </p>
        <button
          onClick={handleOAuthLogin}
          disabled={loading}
          className="btn btn-primary w-full"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Redirecting...
            </span>
          ) : (
            'Login with OAuth'
          )}
        </button>
      </div>

      <div className="mt-6 pt-6 border-t border-[#2B3139]">
        <p className="text-[#848E9C] text-xs">
          <strong>OAuth:</strong> Secure authentication via Keycloak
        </p>
      </div>
    </div>
  );
}
