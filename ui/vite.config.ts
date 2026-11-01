import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // The service serves the built app at http://127.0.0.1:8787/app/.
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      // The service worker is its own entry with a fixed name: browsers register it by URL.
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: { entryFileNames: chunk => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js' },
    },
  },
  server: {
    // `npm run ui:dev` forwards API calls to a running `npm run cli -- web`.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
