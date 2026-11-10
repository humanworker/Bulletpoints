import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Inline (empty) PostCSS config, so the main app's Tailwind setup one folder up isn't picked up
  css: { postcss: { plugins: [] } },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
