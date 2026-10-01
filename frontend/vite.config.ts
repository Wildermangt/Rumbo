import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import vuetify from 'vite-plugin-vuetify';

export default defineConfig({
  plugins: [
    vue(),
    // Tree-shaking automático de componentes Vuetify.
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // En desarrollo, /api se redirige al backend local (en Docker lo hace nginx).
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
});
