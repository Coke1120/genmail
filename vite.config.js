import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'src/assets',
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3001' } },
});
