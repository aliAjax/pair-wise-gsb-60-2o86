import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 18460,
    strictPort: true
  },
  preview: {
    port: 18460,
    strictPort: true
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
