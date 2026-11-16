import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  base: './',
  define: { __VERSION__: JSON.stringify(version) },
  server: { port: 5173 },
})
