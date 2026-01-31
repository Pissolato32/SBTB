
import { defineConfig } from 'vite';

// Environment variables prefixed with VITE_ are automatically loaded by Vite
// from .env files and exposed on import.meta.env.
// The loadEnv and define calls for this purpose are not needed.
export default defineConfig(({ }) => {
    const backendPort = process.env.PORT || 3001; // Match backend port from server/.env or default
    return {
      server: {
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:3001',
            changeOrigin: true,
          }
        }
      }
    };
});
