import { defineConfig } from 'vite';

// In dev, the Vite server proxies /ws to the local game server so the client
// code can always connect to its own origin (same as behind nginx in Docker).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
