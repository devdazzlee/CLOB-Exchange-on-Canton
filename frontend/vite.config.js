import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/canton': {
        target: 'https://participant.dev.canton.wolfedgelabs.com',
        changeOrigin: true,
        rewrite: (path) => {
          // /api/canton/v1/query -> /json-api/v1/query
          // Based on user info: "participant.dev.canton.wolfedgelabs.com/json-api points to json-api"
          const rewritten = path.replace(/^\/api\/canton/, '/json-api');
          return rewritten;
        },
        secure: true,
        ws: false,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
            
            // Handle preflight OPTIONS requests
            if (req.method === 'OPTIONS') {
              res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Max-Age': '86400'
              });
              res.end();
              return;
            }
            
            // Always prefer client's OAuth token from Authorization header
            const existingAuth = proxyReq.getHeader('Authorization');
            if (existingAuth) {
              console.log('[Dev Proxy] Using client OAuth token from Authorization header');
            } else {
              // DEV ONLY: Fallback to .env token for development convenience
              // WARNING: This is for local development only - production proxy requires client token
              // Load .env file manually since Vite proxy runs in Node context
              const envPath = path.join(__dirname, '.env');
              if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/VITE_CANTON_JWT_TOKEN=(.+)/);
                if (match && match[1]) {
                  const jwtToken = match[1].trim();
                  proxyReq.setHeader('Authorization', `Bearer ${jwtToken}`);
                  console.warn('[Dev Proxy] WARNING: Using .env token fallback - this is DEV ONLY. Production requires client OAuth token.');
                } else {
                  console.warn('[Dev Proxy] No Authorization header and no .env token found - request may fail');
                }
              } else {
                console.warn('[Dev Proxy] No Authorization header and no .env file found - request may fail');
              }
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log(`[Proxy] Response: ${proxyRes.statusCode} for ${req.url}`);
            
            // Add CORS headers for development
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
          });
          proxy.on('error', (err, req, res) => {
            console.error('[Proxy Error]', err.message);
          });
        }
      }
    }
  },
  define: {
    'global': 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    include: ['buffer', '@scure/bip39', '@noble/hashes'],
  },
})

