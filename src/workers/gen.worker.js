import { pipeline, TextStreamer } from '@huggingface/transformers';
import { runtime } from './runtime.js';
import { loadOnce } from './once.js';

// In-browser instruct LLM (transformers.js). Runs on WebGPU when available, WASM otherwise.

// default when the caller does not say (the catalogue in src/lib/workers.js does)
const DTYPES = { webgpu: 'q4f16', wasm: 'q4' };

const loadModel = loadOnce(async (key, model, dtypes) => {
  const rt = await runtime();
  const dtype = dtypes[rt.device] || DTYPES[rt.device];
  const generator = await pipeline('text-generation', model, {
    device: rt.device,
    dtype,
    progress_callback: (p) => self.postMessage({ type: 'progress', progress: p }),
  });
  self.postMessage({ type: 'ready', ...rt, dtype });
  return { generator, device: rt.device };
});
const load = (model, dtypes = DTYPES) => loadModel(`${model} ${JSON.stringify(dtypes)}`, model, dtypes);

self.onmessage = async (e) => {
  const { id, type, model, dtypes, messages, maxTokens, temperature, topP } = e.data;
  try {
    const { generator, device } = await load(model, dtypes);
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
