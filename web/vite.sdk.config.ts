import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  base: './',
  define: { 'import.meta.env.BASE_URL': JSON.stringify(process.env.BASE_PATH || '/') },
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: false,
    lib: { entry: 'src/migrator.ts', formats: ['es'], fileName: 'migrator' },
  },
});
