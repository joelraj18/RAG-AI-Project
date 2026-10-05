import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// transformers.js loads the onnxruntime wasm from jsDelivr at runtime, so the ~26 MB
// copy that the bundler emits is never requested. Dropping it keeps deploys small.
const dropUnusedOrtWasm = {
  name: 'drop-unused-ort-wasm',
  generateBundle(_, bundle) {
    for (const f of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(f)) delete bundle[f];
  },
};

// base './' makes the build work on GitHub Pages (/<repo>/), Hugging Face Spaces and any static host.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es', plugins: () => [dropUnusedOrtWasm] },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { plugins: [dropUnusedOrtWasm] } },
  test: { environment: 'node' },
});
