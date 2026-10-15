import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the admin talks to the API through this proxy, so there's no CORS setup.
// In production set VITE_API_URL (e.g. https://api.cullinari.com).
const api = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/socket.io': { target: api, ws: true, changeOrigin: true },
    },
  },
});
