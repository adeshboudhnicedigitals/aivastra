import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env['NODE_ENV'] === 'production' ? '/webtool-admin/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
      '/admin': 'http://127.0.0.1:4000',
    },
  },
});
