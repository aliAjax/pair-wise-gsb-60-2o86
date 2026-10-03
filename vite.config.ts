import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 18460,
    strictPort: true
  },
  preview: {
    port: 18460,
    strictPort: true
  }
});
