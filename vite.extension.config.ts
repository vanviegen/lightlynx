import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { createHash } from 'crypto';

function contentHashPlugin(): Plugin {
  return {
    name: 'content-hash',
    generateBundle(options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && fileName === 'extension.js') {
          const hash = createHash('sha256').update(chunk.code).digest('hex').slice(0, 8);
          chunk.code = `// hash=${hash}\n${chunk.code}`;
        }
      }
    }
  };
}

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
  },
  plugins: [contentHashPlugin()],
});
