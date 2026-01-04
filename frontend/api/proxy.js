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

    // SOLUTION: Use localStorage token first (has actAs/readAs), fallback to static token
    let cantonToken = req.headers.authorization;
    
    // Check if localStorage token has actAs/readAs claims
    if (cantonToken) {
      try {
        const tokenParts = cantonToken.split(' ');
        const jwtToken = tokenParts[1];
        const jwtParts = jwtToken.split('.');
        
        if (jwtParts.length === 3) {
          const payload = JSON.parse(atob(jwtParts[1]));
          
          // Check if token has required claims
          if (payload.actAs && payload.readAs) {
            console.log('[Proxy] Using localStorage token (has actAs/readAs claims)');
          } else {
            // Use static token if localStorage token missing claims
            const staticToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njc1MjAzOTUsImlhdCI6MTc2NzUxODU5NSwiYXV0aF90aW1lIjoxNzY3NTE4NTk0LCJqdGkiOiJvZnJ0YWM6MGNiNGY4ZDktYjE2MC1kM2Q2LTU5ZmEtYjNhYTE3ZWU1ODQ2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOlsiaHR0cHM6Ly9jYW50b24ubmV0d29yay5nbG9iYWwiLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQudGFpbGViNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6Ijg5NTJlMmFjLTBlN2EtNGE1Ni1iYTNhLTgxZjM4MDUzMzkxZiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.IPIXZFL1u-dmQQsI05ttwYYD5YDIAcvnGKms8u_2MQk2wM09K4AgSEc36a0RfsMx6kuCOmUvah8NbB7b7wedBkjoFzoPXNLW9-SBEZ9voVGNRkK2S8QXAwpkcRcTtNcTvfcuH-aKICNuRj4dHLgOSxzYFNVzMAPmATSTt9_mBd2FWlinDt_roCpWddtAWnSui_MVNlyz55Rf8ZAXkMoEROs_FMyAQIsoYifrmU8cskL2wigke_KmHT0W5TtPpqHiYUxuakFVe_Bg8AnZ0lhTXki7lEuk4cW2aSq2fYd17CcezBWqem83VmbUlI3JuT2MH-c6fuuRp3G5XXzOPCQfAw';
            cantonToken = `Bearer ${staticToken}`;
            console.log('[Proxy] Using static token (localStorage missing actAs/readAs claims)');
          }
        }
      } catch (error) {
        console.error('[Proxy] Error checking localStorage token:', error);
      }
    } else {
      // No token at all, use static token
      const staticToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njc1MjAzOTUsImlhdCI6MTc2NzUxODU5NSwiYXV0aF90aW1lIjoxNzY3NTE4NTk0LCJqdGkiOiJvZnJ0YWM6MGNiNGY4ZDktYjE2MC1kM2Q2LTU5ZmEtYjNhYTE3ZWU1ODQ2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOlsiaHR0cHM6Ly9jYW50b24ubmV0d29yay5nbG9iYWwiLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQudGFpbGViNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6Ijg5NTJlMmFjLTBlN2EtNGE1Ni1iYTNhLTgxZjM4MDUzMzkxZiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.IPIXZFL1u-dmQQsI05ttwYYD5YDIAcvnGKms8u_2MQk2wM09K4AgSEc36a0RfsMx6kuCOmUvah8NbB7b7wedBkjoFzoPXNLW9-SBEZ9voVGNRkK2S8QXAwpkcRcTtNcTvfcuH-aKICNuRj4dHLgOSxzYFNVzMAPmATSTt9_mBd2FWlinDt_roCpWddtAWnSui_MVNlyz55Rf8ZAXkMoEROs_FMyAQIsoYifrmU8cskL2wigke_KmHT0W5TtPpqHiYUxuakFVe_Bg8AnZ0lhTXki7lEuk4cW2aSq2fYd17CcezBWqem83VmbUlI3JuT2MH-c6fuuRp3G5XXzOPCQfAw';
      cantonToken = `Bearer ${staticToken}`;
      console.log('[Proxy] Using static token (no localStorage token)');
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
