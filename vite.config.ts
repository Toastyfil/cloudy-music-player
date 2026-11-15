import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import { fileURLToPath, URL } from 'node:url';

// Previewing the renderer in a plain browser (CLOUDY_NO_ELECTRON=1) skips the
// Electron plugin entirely: there is no binary to launch, and a rebuild of the
// main process would try to launch one anyway.
const rendererOnly = Boolean(process.env.CLOUDY_NO_ELECTRON);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    !rendererOnly &&
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['better-sqlite3', 'discord-rpc', 'electron'],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                output: { format: 'cjs', entryFileNames: 'preload.cjs' },
              },
            },
          },
        },
      }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'chrome130',
    sourcemap: false,
  },
  server: {
    port: 5273,
    strictPort: false,
    // Lets a plain-browser preview reach the desktop service: the renderer
    // calls `/api/*` and Vite forwards it to the local catalog server.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
