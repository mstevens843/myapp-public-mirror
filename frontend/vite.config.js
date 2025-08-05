// import { defineConfig } from 'vite';
// import react from '@vitejs/plugin-react';
// import path from 'path';

// export default defineConfig({
//   plugins: [react()],
//   resolve: {
//     alias: {
//       "@solana/web3.js": false, // exclude from client bundle
//       '@': path.resolve(__dirname, './src'),
//     },
//   },
//   server: {
//     host: true,
//     allowedHosts: ['.loca.lt'],
//   },
// });

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    allowedHosts: ['.loca.lt'],
  },
  
});
