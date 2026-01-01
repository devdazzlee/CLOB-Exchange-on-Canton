/**
 * Vercel Serverless Function to proxy Canton API requests
 * This handles CORS for production deployments
 * 
 * Routes: /api/canton/* -> https://participant.dev.canton.wolfedgelabs.com/json-api/*
 * 
 * Vercel automatically recognizes files in the /api directory as serverless functions
 * This function uses the catch-all route [...path] to handle all /api/canton/* requests
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';

// Vercel serverless function handler
// Must be default export for Vercel to recognize it
export default async function handler(req, res) {
  // Log the request for debugging
  console.log(`[Vercel Function] ${req.method} ${req.url}`);
  console.log(`[Vercel Function] Query:`, req.query);
  console.log(`[Vercel Function] Path:`, req.query.path);
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
    
    // Handle empty path (shouldn't happen, but just in case)
    if (!apiPath) {
      res.status(400).json({ error: 'Invalid API path' });
      return;
    }
    
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
    console.log(`[Vercel Proxy] Path segments:`, path);
    console.log(`[Vercel Proxy] Query:`, req.query);

    // Prepare request body
    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // req.body is already parsed by Vercel if Content-Type is application/json
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    }

    // Make the request to Canton API
    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: body,
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
    console.error('[Vercel Proxy] Stack:', error.stack);
    res.status(500).json({
      error: 'Proxy error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

