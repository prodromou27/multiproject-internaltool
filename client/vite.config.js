import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8's default bundler (Rolldown) only accepts the function form of
        // manualChunks, not the id-list object form Rollup also allowed.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const normalized = id.replace(/\\/g, '/'); // module ids use \ on Windows, / elsewhere
          if (/\/(react|react-dom|react-router-dom)\//.test(normalized)) return 'vendor-react';
          if (normalized.includes('/recharts/')) return 'vendor-charts';
          if (normalized.includes('/lucide-react/')) return 'vendor-lucide';
          return undefined;
        },
      },
    },
  },
});
