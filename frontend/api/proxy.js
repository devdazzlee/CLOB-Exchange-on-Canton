// Vercel serverless function to proxy Canton API requests and Keycloak token exchange
// This handles CORS issues by routing requests through Vercel

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Handle Keycloak token exchange
    if (req.url.includes('/keycloak-token')) {
      const { tokenUrl, tokenData } = req.body;
      
      console.log('Proxying Keycloak token request to:', tokenUrl);
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(tokenData),
      });

      const data = await response.json();
      res.status(response.status).json(data);
      return;
    }

    // Handle Canton API requests
    const cantonApiUrl = 'https://participant.dev.canton.wolfedgelabs.com/json-api';
    
    // Get the path from the request URL
    const path = req.url.replace('/api/proxy', '');
    console.log('[Proxy] Original path:', path);
    
    // Remove leading /json-api to avoid duplication since base URL already includes it
    const cleanPath = path.replace(/^\/json-api/, '');
    console.log('[Proxy] Clean path:', cleanPath);
    
    // Construct target URL
    const targetUrl = cleanPath ? `${cantonApiUrl}${cleanPath}` : cantonApiUrl;
    console.log('[Proxy] Proxying to:', targetUrl);

    // Extract client's OAuth token from Authorization header
    // Vercel normalizes headers to lowercase, but we check both to be safe
    const clientToken = req.headers.authorization || req.headers['authorization'] || req.headers['Authorization'];
    
    // Require authentication - no fallback tokens
    if (!clientToken) {
      console.error('[Proxy] Missing Authorization header - client must be authenticated');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Authorization header. Please authenticate first.',
        code: 'MISSING_AUTH_HEADER'
      });
    }

    // Validate token format (should start with 'Bearer ')
    if (!clientToken.startsWith('Bearer ')) {
      console.error('[Proxy] Invalid Authorization header format');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <token>',
        code: 'INVALID_AUTH_FORMAT'
      });
    }

    console.log('[Proxy] Using client OAuth token (from Authorization header)');
    console.log('[Proxy] Token preview:', clientToken.substring(0, 50) + '...');
    
    // Build headers for Canton API request
    const cantonHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Authorization': clientToken, // Forward client's token as-is
    };

    // Forward the request to Canton API with client's token
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: cantonHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    // Handle response
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).send(text);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: 'Proxy error',
      message: error.message 
    });
  }
}
