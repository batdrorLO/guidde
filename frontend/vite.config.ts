import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The NestJS API runs separately; proxying keeps the browser on one origin.
    proxy: { '/api': 'http://localhost:3001' },
  },
});
