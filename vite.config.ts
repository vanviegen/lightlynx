import type { UserConfig } from 'vite'
import { readFileSync, existsSync } from 'fs'

const EXTENSION_PATH = 'build.frontend/extension.js';

function getExtension(): { hash: string, content: string } {
  if (!existsSync(EXTENSION_PATH)) return { hash: '', content: '' };
  const content = readFileSync(EXTENSION_PATH, 'utf-8');
  const match = content.match(/^\/\/ hash=([a-f0-9]{8})/);
  return { hash: match?.[1] || '', content };
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
          if (req.url === '/extension.hash') {
            res.setHeader('Content-Type', 'text/plain');
            res.end(getExtension().hash);
          } else if (req.url === '/extension.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(getExtension().content);
          } else {
            next();
          }
        });
        
        // Watch and reload on extension changes
        server.watcher.add('build.frontend');
        let reloadTimer: NodeJS.Timeout | null = null;
        server.watcher.on('all', (event, file) => {
          if (file.includes('/extensions/') && file.endsWith('.js')) {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
              server.ws.send({ type: 'full-reload', path: '*' });
              reloadTimer = null;
            }, 100);
          }
        });
      }
    }
  ],
  define: {
    __EXTENSION_HASH__: JSON.stringify(getExtension().hash)
  },
  build: {
    emptyOutDir: false
  },
  esbuild: {
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: false
  }
} satisfies UserConfig