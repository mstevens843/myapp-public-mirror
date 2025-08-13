// vite.config.js
/**
 * What changed
 * - Switched to named import: { nodePolyfills } from 'vite-plugin-node-polyfills'
 * - Kept single resolve block (no duplicates)
 * - Dev proxy to backend when VITE_API_BASE_URL is empty
 *
 * Why
 * - Fix “does not provide a default export” error
 * - Prevent frontend/backend mismatch in dev
 *
 * Risk addressed
 * - Startup crash from bad import; 404s from cross-origin dev calls
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const DEV_API_TARGET = process.env.VITE_API_BASE_URL || 'http://localhost:5001';

export default defineConfig({
  plugins: [
    react(),
    // Node core polyfills (Buffer, process, node: protocol, etc.)
    nodePolyfills({
      protocolImports: true,
      // You can enable specific globals if needed:
      // globals: { Buffer: true, process: true },
      // include: ['buffer', 'process'],
    }),
  ],

  // Provide global in browser for libs expecting Node
  define: { global: 'globalThis' },

  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer',
      process: 'process/browser',
      // Add more as needed:
      // stream: 'stream-browserify',
      // util: 'util',
      // events: 'events',
      // crypto: 'crypto-browserify',
    },
  },

  // Only expose VITE_* to the client
  envPrefix: ['VITE_'],

  server: {
    host: true,
    allowedHosts: ['.loca.lt'],
    strictPort: false,
    hmr: { overlay: true },
    headers: {
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    proxy: {
      // Same-origin /api calls hit your backend in dev
      '/api': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/socket.io': {
        target: DEV_API_TARGET,
        ws: true,
      },
    },
  },

  preview: {
    headers: {
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },

  build: {
    sourcemap: false, // don't ship source maps in prod
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // simple vendor chunk to avoid leaking module paths in many small chunks
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
    target: 'es2020',
  },
});
