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
            
            // Check if Authorization header is already present from client
            const existingAuth = proxyReq.getHeader('Authorization');
            if (existingAuth) {
              console.log('[Proxy] Authorization header already present from client');
            } else {
              // Add JWT token from environment variable if not present
              // Load .env file manually since Vite proxy runs in Node context
              const envPath = path.join(__dirname, '.env');
              if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/VITE_CANTON_JWT_TOKEN=(.+)/);
                if (match && match[1]) {
                  const jwtToken = match[1].trim();
                  proxyReq.setHeader('Authorization', `Bearer ${jwtToken}`);
                  console.log('[Proxy] Added JWT token from .env file');
                }
              }
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log(`[Proxy] Response: ${proxyRes.statusCode} for ${req.url}`);
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

