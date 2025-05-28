
import { defineConfig } from 'vite';

// Environment variables prefixed with VITE_ are automatically loaded by Vite
// from .env files and exposed on import.meta.env.
// The loadEnv and define calls for this purpose are not needed.
export default defineConfig(({ }) => {
    const backendPort = process.env.PORT || 3001; // Match backend port from server/.env or default
    return {
      // resolve: {
      //   alias: {
      //     '@': path.resolve(__dirname, '.'), // Ensure path is imported if you uncomment this
      //   }
      // },
      server: {
        proxy: {
          // Proxy /api requests to the backend server
          '/api': {
            target: `http://localhost:${backendPort}`, // URL of your backend server
            changeOrigin: true, // Recommended for virtual hosted sites
            // secure: false, // Uncomment if your backend server is not HTTPS (common in dev)
            // rewrite: (path) => path.replace(/^\/api/, '/api') // Keeps /api in the path to backend
          }
        }
      }
    };
});
