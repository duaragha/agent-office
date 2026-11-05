import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served by the hub under /office (Tailscale Serve keeps the path), so the
// client is built for that base. `npm run dev` proxies to a local hub.
const hub = process.env.OFFICE_HUB_DEV || 'http://127.0.0.1:8825'

export default defineConfig({
  base: '/office/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 2000,
  },
  server: {
    proxy: {
      '/office/api': hub,
      '/office/ws': { target: hub.replace(/^http/, 'ws'), ws: true },
    },
  },
})
