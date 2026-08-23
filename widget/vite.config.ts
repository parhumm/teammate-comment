import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    // IIFE, not ESM. `document.currentScript` is null inside a module script,
    // and reading the project key back out of the script's own src is what
    // makes the one-string install work.
    lib: {
      entry: 'src/index.tsx',
      formats: ['iife'],
      name: 'TeammateComment',
      fileName: () => 'widget.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        // One file, always. The host page gets exactly one request.
        inlineDynamicImports: true,
      },
    },
  },
})
