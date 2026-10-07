import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the game server at /admin; in development Vite proxies the API to it.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/admin/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
