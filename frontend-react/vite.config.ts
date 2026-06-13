import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'

function gitVersion(): string {
  try {
    return execSync('git describe --tags --always', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../filestation-go/webembed/web',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:58427',
    },
  },
})
