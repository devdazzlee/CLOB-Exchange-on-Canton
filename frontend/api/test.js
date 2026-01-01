/**
 * Simple test endpoint to verify Vercel serverless functions are working
 * Access at: /api/test
 */

export default async function handler(req, res) {
  res.status(200).json({
    success: true,
    message: 'Vercel serverless function is working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    query: req.query,
  });
}

