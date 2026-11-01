import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          return id.includes('chart.js') || id.includes('react-chartjs-2') ? 'charts' : 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT || process.env.PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
})
