import type { UserConfig } from 'vite'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

function getExtensionVersions(): Record<string, string> {
  const extensionsDir = 'build.frontend/extensions';
  const versions: Record<string, string> = {};
  
  if (existsSync(extensionsDir)) {
    const files = readdirSync(extensionsDir);
    for (const file of files) {
      const match = file.match(/^lightlynx-(.*)-([a-f0-9]{8})\.js$/);
      if (match) {
        versions[match[1]!] = match[2]!;
      }
    }
  }
  
  return versions;
}

export default {
  server: {
    allowedHosts: true
  },
  plugins: [
    {
      name: 'serve-extensions',
      configureServer(server) {
        // Serve extension files
        server.middlewares.use('/extensions', (req, res, next) => {
          // Serve dynamic versions.json in dev mode
          if (req.url === '/versions.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(getExtensionVersions()));
            return;
          }
          
          // Serve extension JS files
          try {
            const content = readFileSync(join('build.frontend/extensions', req.url || ''))
            res.setHeader('Content-Type', 'application/javascript')
            res.end(content)
          } catch {
            next()
          }
        })
        
        // Watch extensions directory and trigger full reload when files change
        // Watch parent to handle directory recreation on build
        server.watcher.add('build.frontend');
        
        let reloadTimer: NodeJS.Timeout | null = null;
        server.watcher.on('all', (event, file) => {
          if (file.includes('/extensions/') && file.endsWith('.js')) {
            console.log(`Extension ${event}: ${file}, reloading...`);
            
            // Debounce reloads to avoid multiple reloads during build
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
              console.log('Sending full-reload to clients');
              server.ws.send({ type: 'full-reload', path: '*' });
              reloadTimer = null;
            }, 100);
          }
        });
      }
    }
  ],
  define: {
    __EXTENSION_VERSIONS__: JSON.stringify(getExtensionVersions())
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