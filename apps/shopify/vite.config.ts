import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  base: process.env.NODE_ENV === 'production' ? '/shopify-admin/' : '/',
  server: {
    port: 5174,
    // Needed to load this dev server through the ngrok tunnel used for local
    // Shopify embedded-app testing (Vite 6's host-check otherwise 403s any
    // Host header it doesn't recognize).
    allowedHosts: ['.ngrok-free.dev'],
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
    },
  },
});
