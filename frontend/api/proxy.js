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
    console.log('Original path:', path);
    
    // Remove leading /json-api to avoid duplication since base URL already includes it
    const cleanPath = path.replace(/^\/json-api/, '');
    console.log('Clean path:', cleanPath);
    
    // Construct target URL
    const targetUrl = cleanPath ? `${cantonApiUrl}${cleanPath}` : cantonApiUrl;
    console.log('Proxying Canton API request to:', targetUrl);

    // Get JWT from request header or use fallback
    let cantonToken = req.headers.authorization;
    
    // If no token in header, try to get from environment (like old code)
    if (!cantonToken) {
      const envToken = process.env.VITE_CANTON_JWT_TOKEN;
      if (envToken) {
        cantonToken = `Bearer ${envToken}`;
        console.log('[Proxy] Using token from environment variable');
      }
    }
    
    // Final fallback
    if (!cantonToken) {
      cantonToken = 'Bearer temp-token';
    }
    
    // Forward the request to Canton API
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Authorization': cantonToken,
      },
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
