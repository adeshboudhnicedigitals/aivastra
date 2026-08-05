import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
      '/admin': 'http://127.0.0.1:4000',
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
      '/admin': 'http://127.0.0.1:4000',
    },
  },
});
