import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'site',
  publicDir: resolve(__dirname, 'build.video'),
  build: {
    outDir: resolve(__dirname, 'build.site'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'site/index.html'),
    },
  },
});
