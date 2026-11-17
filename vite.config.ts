import { defineConfig } from 'vite';

// The AI service (ai/, Python FastAPI) runs on port 8000. Vite forwards /api to it, so the
// browser never sees API keys or provider URLs.
const AI_URL = process.env.AI_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  server: { port: 5173, proxy: { '/api': { target: AI_URL, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: AI_URL, changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 2000 },
});
