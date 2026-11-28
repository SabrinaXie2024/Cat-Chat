/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Router plugin must come before react().
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    // Used when MSW is off (`pnpm dev:web:real` from the repo root): forward to the Go server.
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'happy-dom',
    // Give relative fetches ('/api/...') an origin to resolve against.
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
