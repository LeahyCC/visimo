import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The demo is the only build target. The package itself ships TypeScript
// source, so there is no library build here to configure.
export default defineConfig({
  root: 'demo',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  // Unit tests are for pure TypeScript and run in Node. Anything that needs a
  // GPU has to be driven in a real browser by hand.
  test: { root: '.', include: ['src/**/*.test.ts'], environment: 'node' },
})
