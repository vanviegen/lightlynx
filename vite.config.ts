import type { UserConfig } from 'vite'
import { readFileSync } from 'fs'
import { join } from 'path'

export default {
  server: {
    allowedHosts: true
  },
  plugins: [
    {
      name: 'serve-extensions',
      configureServer(server) {
        server.middlewares.use('/extensions', (req, res, next) => {
          try {
            const content = readFileSync(join('build.frontend/extensions', req.url || ''))
            res.setHeader('Content-Type', 'application/javascript')
            res.end(content)
          } catch {
            next()
          }
        })
      }
    }
  ],
  esbuild: {
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: false
  }
} satisfies UserConfig