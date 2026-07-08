import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  base: process.env.NODE_ENV === 'production' ? '/shopify-admin/' : '/',
  server: {
    port: 5174,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
    },
  },
});
