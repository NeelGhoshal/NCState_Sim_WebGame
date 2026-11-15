import { defineConfig, loadEnv } from 'vite';
import { llmProxy } from './server/llmProxy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [llmProxy(env)],
    server: { port: 5173 },
    build: { chunkSizeWarningLimit: 2000 },
  };
});
