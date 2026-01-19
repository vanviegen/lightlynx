import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { createHash } from 'crypto';

function contentHashPlugin(): Plugin {
  return {
    name: 'content-hash',
    generateBundle(options, bundle) {
      // Hash each chunk's content and rename it
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && fileName.match(/^lightlynx-(api|automation)\.js$/)) {
          const hash = createHash('sha256').update(chunk.code).digest('hex').slice(0, 8);
          const match = fileName.match(/^(lightlynx-(?:api|automation))\.js$/);
          if (match) {
            const newFileName = `${match[1]}-${hash}.js`;
            bundle[newFileName] = chunk;
            delete bundle[fileName];
            chunk.fileName = newFileName;
          }
        }
      }
    }
  };
}

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
    minify: false,
  },
  plugins: [contentHashPlugin()],
});
