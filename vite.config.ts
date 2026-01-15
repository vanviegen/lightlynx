import type { UserConfig } from 'vite'

export default {
  server: {
    allowedHosts: true
  },
  esbuild: {
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: false
  }
} satisfies UserConfig