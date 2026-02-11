import type { UserConfig } from 'vite'
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const EXTENSION_PATH = 'build.frontend/extension.js';

/** Recursively list all files in a directory, returning paths relative to root. */
function listFiles(dir: string, root = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(e => {
    const full = join(dir, e.name);
    return e.isDirectory() ? listFiles(full, root) : ['/' + full.slice(root.length + 1)];
  });
}

export default {
  server: {
    allowedHosts: true
  },
  plugins: [
    {
      name: 'serve-extension',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/extension.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(existsSync(EXTENSION_PATH) ? readFileSync(EXTENSION_PATH, 'utf-8') : '');
          } else {
            next();
          }
        });
      }
    },
    {
      name: 'generate-files-txt',
      writeBundle(options) {
        const outDir = options.dir!;
        const files = listFiles(outDir)
          .filter(f => !f.startsWith('/extension') && !f.startsWith('/sw-') && !f.endsWith('/files.txt'));
        writeFileSync(join(outDir, 'files.txt'), files.join('\n') + '\n');
      }
    }
  ],
  build: {
    emptyOutDir: false
  },
  esbuild: {
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: false
  }
} satisfies UserConfig