import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // Temporary: production stack traces are minified into useless names
    // (e.g. "at QE", "at Tx") which made a real crash impossible to trace
    // to a source line. Source maps let the browser devtools resolve real
    // file/line/function names instead. Revert once the bracket-rendering
    // crash is found and fixed.
    sourcemap: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Aerospace Summer Games',
        short_name: 'ASG',
        description: 'Live scores, brackets, and standings for the Aerospace Summer Games',
        theme_color: '#0f172a',
        background_color: '#b08040',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
