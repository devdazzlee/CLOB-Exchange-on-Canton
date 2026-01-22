import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@clob-exchange/crypto': path.resolve(__dirname, '../../packages/crypto/src'),
      '@clob-exchange/api-clients': path.resolve(__dirname, '../../packages/api-clients/src'),
      buffer: 'buffer',
    },
  },
  define: {
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: ['@clob-exchange/crypto', '@clob-exchange/api-clients', 'buffer'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
