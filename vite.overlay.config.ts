import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname, 'src/overlay'),
  base: '/static/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/overlay'),
    emptyOutDir: true,
    target: 'chrome103',
  },
});
