import { env } from '@huggingface/transformers';

// Shared ONNX Runtime setup for the model workers (embeddings, reranker, in-browser LLM).
//  - WebGPU only with a hardware adapter: a software (fallback) adapter is slower than WASM.
//  - WASM threads need a cross-origin isolated page (COOP/COEP headers). Without isolation the
//    runtime is limited to one thread; with it, every worker uses all cores (up to 8). On a 4 core
//    machine 4 threads beat 3 and 2 for both embeddings and the in-browser LLM (README,
//    "Performance"); the workers take turns, so they rarely compete for the cores.
//  - Without WebGPU, the plain ORT build (14 MB) replaces the asyncify build (27 MB) that
//    transformers.js picks so it can also drive WebGPU.
env.allowLocalModels = false;

let info = null;

/** Configure the runtime once per worker, before the first model loads. */
export async function runtime() {
  if (info) return info;
  const adapter = typeof navigator !== 'undefined' && 'gpu' in navigator ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const softwareGpu = !!(adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter);
  const webgpu = !!adapter && !softwareGpu;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const threads = self.crossOriginIsolated ? Math.max(1, Math.min(8, cores)) : 1;
  const ort = env.backends.onnx;
  if (ort?.wasm) {
    ort.wasm.numThreads = threads;
    if (!webgpu && ort.versions?.web) {
      const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.versions.web}/dist/`;
      ort.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.mjs`, wasm: `${base}ort-wasm-simd-threaded.wasm` };
    }
  }
  info = { device: webgpu ? 'webgpu' : 'wasm', threads, build: webgpu ? 'asyncify' : 'plain', softwareGpu };
  return info;
}
