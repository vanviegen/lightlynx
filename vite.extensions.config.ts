import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'build.frontend/extensions',
    emptyOutDir: true,
    lib: {
      entry: {
        'lightlynx-api': resolve(__dirname, 'src/extensions/lightlynx-api.ts'),
        'lightlynx-automation': resolve(__dirname, 'src/extensions/lightlynx-automation.ts'),
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
    minify: false, // Easier debugging for now
  },
});
