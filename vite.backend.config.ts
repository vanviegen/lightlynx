import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    publicDir: false,
    build: {
      outDir: 'build.backend',
      lib: {
        entry: resolve(__dirname, 'src/backend/cert.ts'),
        formats: ['es'],
        fileName: 'cert',
      },
      rollupOptions: {
        external: (id) => id.startsWith('https://'),
      },
      minify: false,
      emptyOutDir: true,
    },
    define: {
      'process.env.BUNNY_DNS_ZONE_ID': JSON.stringify(env.BUNNY_DNS_ZONE_ID),
      'process.env.BUNNY_ACCESS_KEY': JSON.stringify(env.BUNNY_ACCESS_KEY),
      'process.env.CERT_SERVER_SECRET': JSON.stringify(env.CERT_SERVER_SECRET),
      'process.env.BUNNY_DB_URL': JSON.stringify(env.BUNNY_DB_URL),
      'process.env.BUNNY_DB_TOKEN': JSON.stringify(env.BUNNY_DB_TOKEN),
    }
  };
});
