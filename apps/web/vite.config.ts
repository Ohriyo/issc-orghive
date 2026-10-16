import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Fills %SITE_URL% in index.html, so the default og:image is absolute as Facebook requires.
 * Unlike Vite's own %VITE_*% replacement, an unset VITE_SITE_URL becomes "" (a relative
 * URL) instead of leaving the placeholder in the page.
 */
function siteUrlInHtml(siteUrl: string): Plugin {
  return {
    name: 'orghive-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl.replace(/\/+$/, '')),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), siteUrlInHtml(loadEnv(mode, import.meta.dirname).VITE_SITE_URL ?? '')],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls in dev, so the SameSite=Strict refresh cookie just works.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
