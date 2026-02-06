import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'build.frontend',
    emptyOutDir: false,
    lib: {
      entry: {
        'extension': resolve(__dirname, 'src/extension.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['crypto', 'fs', 'path', 'http', 'https', 'os', 'dgram', 'ws'],
      output: {
        entryFileNames: '[name].js',
        interop: 'compat',
      },
    },
    minify: false,
  }
});
