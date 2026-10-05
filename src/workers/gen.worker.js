import { pipeline, TextStreamer, env } from '@huggingface/transformers';

// In-browser instruct LLM (transformers.js). Runs on WebGPU when available, WASM otherwise.
env.allowLocalModels = false;

let generator = null;
let loaded = null;
let device = 'wasm';

async function load(model) {
  if (generator && loaded === model) return;
  const gpu = 'gpu' in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
  device = gpu ? 'webgpu' : 'wasm';
  generator = await pipeline('text-generation', model, {
    device,
    dtype: device === 'webgpu' ? 'q4f16' : 'q4',
    progress_callback: (p) => self.postMessage({ type: 'progress', progress: p }),
  });
  loaded = model;
  self.postMessage({ type: 'ready', device });
}

self.onmessage = async (e) => {
  const { id, type, model, messages, maxTokens, temperature, topP } = e.data;
  try {
    await load(model);
    if (type === 'load') return self.postMessage({ id, type: 'done' });
    let text = '';
    let count = 0;
    let ttft = null;
    const t0 = performance.now();
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk) => {
        if (ttft == null) ttft = performance.now() - t0;
        text += chunk;
        count++;
        self.postMessage({ id, type: 'token', text });
      },
    });
    const promptTokens = generator.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: true,
      return_tensor: false,
    }).length;
    await generator(messages, {
      max_new_tokens: maxTokens,
      do_sample: temperature > 0,
      temperature: temperature > 0 ? temperature : undefined,
      top_p: topP,
      streamer,
    });
    const completionTokens = generator.tokenizer.encode(text).length;
    self.postMessage({
      id,
      type: 'done',
      result: {
        text: text.trim(),
        finishReason: completionTokens >= maxTokens ? 'length' : 'stop',
        promptTokens,
        completionTokens: completionTokens || count,
        latencyMs: performance.now() - t0,
        ttftMs: ttft,
        device,
      },
    });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
