// Vercel serverless function to proxy ALL /api/* requests to the backend
// This is needed because the frontend (static site) and backend (Node.js)
// are deployed as separate Vercel projects.
//
// Configuration: Set BACKEND_URL in Vercel environment variables
// Example: BACKEND_URL=https://clob-backend.vercel.app

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-public-key, x-party-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  if (!BACKEND_URL) {
    return res.status(503).json({
      error: 'Backend not configured',
      message: 'Set BACKEND_URL environment variable in Vercel dashboard',
    });
  }

  try {
    // Forward the request path (strip /api/backend prefix)
    const path = req.url.replace(/^\/api\/backend/, '') || '/';
    const targetUrl = `${BACKEND_URL.replace(/\/$/, '')}${path}`;

    console.log(`[BackendProxy] ${req.method} ${path} → ${targetUrl}`);

    // Forward all headers
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['x-user-id']) headers['x-user-id'] = req.headers['x-user-id'];
    if (req.headers['x-public-key']) headers['x-public-key'] = req.headers['x-public-key'];
    if (req.headers['x-party-id']) headers['x-party-id'] = req.headers['x-party-id'];

    const fetchOptions = {
      method: req.method,
      headers,
    };

    // Forward body for non-GET requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Forward response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (error) {
    console.error('[BackendProxy] Error:', error.message);
    return res.status(502).json({
      error: 'Backend proxy error',
      message: error.message,
    });
  }
}
