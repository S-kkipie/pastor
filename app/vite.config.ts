import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The bridge serves the build from bridge/web; relative base so the same
// build also runs inside a Capacitor shell later.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: '../bridge/web', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': 'http://127.0.0.1:7878' } },
})
