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

// Cross-origin isolation (COOP + COEP) lets onnxruntime-web run the local models on several
// threads. Every cross-origin request the app makes (model files, jsDelivr, LLM APIs) is a CORS
// request, which require-corp allows. The deployed site gets the same headers from the Hugging
// Face Space config (scripts/push_to_hf_space.py) or the service worker (public/coi-sw.js).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

// base './' makes the build work on GitHub Pages (/<repo>/), Hugging Face Spaces and any static host.
export default defineConfig({
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  plugins: [react(), tailwindcss()],
  worker: { format: 'es', plugins: () => [dropUnusedOrtWasm] },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { plugins: [dropUnusedOrtWasm] } },
  test: { environment: 'node' },
});
