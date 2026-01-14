import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'build.backend',
    lib: {
      entry: resolve(__dirname, 'src/backend/cert.ts'),
      formats: ['es'],
      fileName: 'cert',
    },
    rollupOptions: {
      external: (id) => id.startsWith('https://'),
    },
    minify: false,
    emptyOutDir: true,
  },
});
