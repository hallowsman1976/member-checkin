import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // exceljs (~930 kB) is loaded only when exporting/importing; everything else stays well below this.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
