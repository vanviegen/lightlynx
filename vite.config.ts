import type { UserConfig } from 'vite'
import { readFileSync, existsSync } from 'fs'

const EXTENSION_PATH = 'build.frontend/extension.js';

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