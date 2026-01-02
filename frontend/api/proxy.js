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

    // TEMP WORKAROUND: Use a working static token until JWT claims are fixed
    // This bypasses the JWT claims issue
    const workingStaticToken = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3NjczODgzNjIsImlhdCI6MTc2NzM4NjU2MiwiYXV0aF90aW1lIjoxNzY3Mzg2NTU2LCJqdGkiOiJvbnJ0YWM6NjcyMTdlZTItYjNlYS04N2I1LWZjZTMtZmYzM2I0MWQxMWVmIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiQ2xvYiIsInNpZCI6IjEwOGYzYTg1LWZkOGUtNDc4Yi04OTBmLTAwZmUzYTQxYzQ1ZiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9jbG9iLWV4Y2hhbmdlLW9uLWNhbnRvbi52ZXJjZWwuYXBwLyoiXSwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbImRlZmF1bHQtcm9sZXMtY2FudG9uLWRldm5ldCIsIm9mZmxpbmVfYWNjZXNzIiwidW1hX2F1dGhvcml6YXRpb24iXX0sInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiLCJ2aWV3LXByb2ZpbGUiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.GjqnzcHg1DrwkazF_ceE-qN1fkxEvufFA7oKEiEvHJkubWW6eA8by0yIIv6bkzFJvfJaNSL2TGXMnT3Ko_jWcL5R_2cP5VzfUPH8Okq5LdaLZi2Ng51ar3RYlr7akRRBZWan3n7iiuvMyY9WN0KK_sRt0n0ZjnXcRQkBOPl7JMT0ZA0s3Mth2UVHkQaw0ZNThPtFzd6GzP45BXUM2rj18Y_2IN20dJ_MvJYra8hSK44j8b7Vw9tXUu2FtiL9fqr7mdp22rxS37M0vQzluiVH45u6QvsNBltahJR5Gdl9veVC5wo3P_SmWu6iQehUYEv-4ErDaSdOAcq38Gzny_DOKg';
    
    let cantonToken = req.headers.authorization;
    
    // If no token in header, try to get from environment (like old code)
    if (!cantonToken) {
      const envToken = process.env.VITE_CANTON_JWT_TOKEN;
      if (envToken) {
        cantonToken = `Bearer ${envToken}`;
        console.log('[Proxy] Using token from environment variable');
      }
    }
    
    // Use working static token as fallback
    if (!cantonToken) {
      cantonToken = workingStaticToken;
      console.log('[Proxy] Using working static token as fallback');
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
