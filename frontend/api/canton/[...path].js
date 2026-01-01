/**
 * Vercel Serverless Function to proxy Canton API requests
 * This handles CORS for production deployments
 * 
 * Routes: /api/canton/* -> https://participant.dev.canton.wolfedgelabs.com/json-api/*
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';

export default async function handler(req, res) {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Get the path from the catch-all route
    // Example: /api/canton/v2/packages -> path = ['v2', 'packages']
    const path = req.query.path || [];
    const apiPath = Array.isArray(path) ? path.join('/') : path;
    
    // Construct the full URL
    // CANTON_API_BASE already includes /json-api, so just append the path
    // Result: https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages
    const url = `${CANTON_API_BASE}/${apiPath}`;
    
    // Get headers from the request
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Forward Authorization header if present
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    
    // Forward other relevant headers
    if (req.headers['x-requested-with']) {
      headers['X-Requested-With'] = req.headers['x-requested-with'];
    }

    console.log(`[Vercel Proxy] ${req.method} ${url}`);
    console.log(`[Vercel Proxy] Headers:`, Object.keys(headers));

    // Make the request to Canton API
    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    // Get response data
    const data = await response.text();
    
    // Forward status code
    res.status(response.status);
    
    // Forward response headers (except CORS headers which we set above)
    response.headers.forEach((value, key) => {
      if (!key.toLowerCase().startsWith('access-control-')) {
        res.setHeader(key, value);
      }
    });

    // Send response
    try {
      // Try to parse as JSON, if it fails, send as text
      const jsonData = JSON.parse(data);
      res.json(jsonData);
    } catch {
      res.send(data);
    }
  } catch (error) {
    console.error('[Vercel Proxy] Error:', error);
    res.status(500).json({
      error: 'Proxy error',
      message: error.message,
    });
  }
}

