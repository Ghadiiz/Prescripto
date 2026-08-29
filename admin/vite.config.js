import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    // globals: false is deliberate. Tests import describe/it/expect explicitly,
    // the same way the backend suite imports from node:test rather than relying
    // on ambient globals — one habit across the repo, and the import makes it
    // obvious which runner a file belongs to.
    globals: false,
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
