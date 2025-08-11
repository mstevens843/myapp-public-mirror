import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const PROD = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  envPrefix: ['VITE_'], // only expose VITE_* to the client
  server: {
    host: true,
    allowedHosts: ['.loca.lt'],
    strictPort: false,
    hmr: { overlay: true },
    headers: {
      // Helpful dev headers; prod security headers come from your backend/proxy
      'Referrer-Policy': 'strict-origin-when-cross-origin',
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