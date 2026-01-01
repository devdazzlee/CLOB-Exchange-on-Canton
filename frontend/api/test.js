/**
 * Simple test endpoint to verify Vercel serverless functions are working
 * Access at: /api/test
 * 
 * This is a simple function to test if Vercel is detecting serverless functions
 */

// Vercel serverless function handler
export default async function handler(req, res) {
  console.log(`[Test Function] ${req.method} ${req.url}`);
  console.log(`[Test Function] Query:`, req.query);
  
  res.status(200).json({
    success: true,
    message: 'Vercel serverless function is working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    query: req.query,
    url: req.url,
  });
}

