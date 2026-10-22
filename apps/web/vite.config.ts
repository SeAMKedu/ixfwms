import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Dev: the API runs on :3000 (npm run dev at the repo root); Vite proxies to it.
const api = process.env.IXF_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // "development" resolves @ixfwms/domain to its TypeScript source, so no prebuild is needed.
  resolve: { conditions: ['development', ...defaultClientConditions] },
  server: {
    host: true,
    proxy: { '/api': api, '/mcp': api, '/healthz': api },
  },
  // One ~170 kB (gzip) bundle is fine on the lab network; split later if it grows.
  build: { sourcemap: true, chunkSizeWarningLimit: 800 },
});
