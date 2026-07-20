import { defineConfig } from 'vite';

// Vite / Rollup 4.62+ rejects the injected `vite/modulepreload-polyfill`
// source-phase import during build. Disabling the polyfill emits a clean
// bundle (modern browsers and WebXR devices support modulepreload natively).
export default defineConfig({
  server: { host: '0.0.0.0' },
  build: {
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
