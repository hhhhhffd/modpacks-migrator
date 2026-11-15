import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  base: './',
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: false,
    lib: { entry: 'src/migrator.ts', formats: ['es'], fileName: 'migrator' },
  },
});
