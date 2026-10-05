import { describe, it, expect, vi, afterEach } from 'vitest';
import { generate, listModels, LLMError } from '../llm.js';
import { buildClaudeRequest, FALLBACK_BETA } from '../anthropic.js';
import { PROVIDERS, KEY_PROVIDERS, dataClass, dataHost, isLocalUrl, llmReady, keyWarning } from '../providers.js';
import { DEFAULT_SETTINGS, persistable } from '../settings.js';
import { friendlyError } from '../hf.js';
import { modelName } from '../pipeline.js';

const sse = (text) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const msg = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Excerpt: secret plan. Question?' }] };
const withKey = (provider, key = 'sk-test', extra = {}) => ({ ...DEFAULT_SETTINGS, provider, apiKeys: { [provider]: key }, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe('provider registry', () => {
  it('has every bring-your-own-key provider with links and a base URL or SDK', () => {
    for (const id of ['anthropic', 'deepseek', 'openai', 'gemini', 'groq', 'mistral', 'openrouter']) expect(KEY_PROVIDERS).toContain(id);
    for (const id of KEY_PROVIDERS) {
      const p = PROVIDERS[id];
      expect(p.keysUrl).toMatch(/^https:\/\//);
      expect(p.policyUrl).toMatch(/^https:\/\//);
      expect(p.kind === 'anthropic' || /^https:\/\//.test(p.baseUrl)).toBe(true);
      expect(p.data).toBe('cloud');
    }
  });
  it('classifies where data goes', () => {
    expect(dataClass({ provider: 'extractive' })).toBe('device');
    expect(dataClass({ provider: 'browser' })).toBe('device');
    expect(dataClass({ provider: 'hf' })).toBe('cloud');
    expect(dataClass({ provider: 'custom', openaiBaseUrl: 'http://localhost:11434/v1' })).toBe('device');
    expect(dataClass({ provider: 'custom', openaiBaseUrl: 'http://127.0.0.1:1234/v1' })).toBe('device');
    expect(dataClass({ provider: 'custom', openaiBaseUrl: 'https://api.example.com/v1' })).toBe('cloud');
    expect(dataHost({ provider: 'deepseek' })).toBe('api.deepseek.com');
    expect(isLocalUrl('http://evil.com/localhost')).toBe(false);
  });
  it('knows when a key is missing and warns about keys pasted into the wrong provider', () => {
    expect(llmReady({ ...DEFAULT_SETTINGS, provider: 'anthropic' })).toBe(false);
    expect(llmReady(withKey('anthropic', 'sk-ant-x'))).toBe(true);
    expect(keyWarning('openai', 'sk-ant-abc')).toMatch(/Anthropic/);
    expect(keyWarning('anthropic', 'sk-ant-abc')).toBe('');
    expect(keyWarning('groq', 'xyz')).toMatch(/gsk_/);
  });
  it('reports the model in use', () => {
    expect(modelName(withKey('anthropic'))).toBe('claude-opus-5-5');
    expect(modelName(withKey('deepseek', 'k', { apiModels: { deepseek: 'deepseek-reasoner' } }))).toBe('deepseek-reasoner');
  });
});

describe('API keys stay in memory', () => {
  it('never persists apiKeys, but keeps the chosen models', () => {
    const out = persistable({ ...DEFAULT_SETTINGS, apiKeys: { anthropic: 'sk-ant-SECRET' }, apiModels: { anthropic: 'claude-haiku-4-5' } });
    expect(JSON.stringify(out)).not.toMatch(/SECRET/);
    expect(out.apiModels.anthropic).toBe('claude-haiku-4-5');
  });
});

describe('OpenAI-compatible key providers', () => {
  it.each([
    ['deepseek', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'deepseek/deepseek-chat'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile'],
  ])('%s calls its own endpoint with the key', async (id, url, model) => {
    const fetch = vi.fn().mockResolvedValue(sse('ok'));
    vi.stubGlobal('fetch', fetch);
    const r = await generate(withKey(id, 'sk-KEY'), msg);
    expect(r.text).toBe('ok');
    expect(fetch.mock.calls[0][0]).toBe(url);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-KEY');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe(model);
  });
  it('asks for the key when it is missing', async () => {
    const err = await generate({ ...DEFAULT_SETTINGS, provider: 'deepseek' }, msg).catch((e) => e);
    expect(err.message).toMatch(/DeepSeek API key/);
  });
  it('explains a browser block (CORS) and suggests OpenRouter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await generate(withKey('mistral'), msg).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.status).toBe(0);
    expect(err.hint).toMatch(/OpenRouter/);
  });
  it('lists models from the provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }))));
    expect(await listModels(withKey('openai'))).toEqual(['a', 'b']);
  });
  it('counts what left the device', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('ok')));
    const _meter = { host: null, calls: 0, promptTokens: 0 };
    await generate({ ...withKey('deepseek'), _meter }, msg);
    expect(_meter).toEqual({ host: 'api.deepseek.com', calls: 1, promptTokens: 10 });
  });
});

describe('Confidential mode', () => {
  it('blocks every cloud provider before any request is made', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const s of [withKey('anthropic'), withKey('deepseek'), { ...DEFAULT_SETTINGS, provider: 'hf', hfToken: 'hf_x' }, { ...DEFAULT_SETTINGS, provider: 'custom', openaiBaseUrl: 'https://api.example.com/v1' }]) {
      const err = await generate({ ...s, confidential: true }, msg).catch((e) => e);
      expect(err.title).toBe('Confidential mode is on');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('still allows a model on localhost', async () => {
    const fetch = vi.fn().mockResolvedValue(sse('local'));
    vi.stubGlobal('fetch', fetch);
    const r = await generate({ ...DEFAULT_SETTINGS, provider: 'custom', confidential: true }, msg);
    expect(r.text).toBe('local');
    expect(fetch.mock.calls[0][0]).toMatch(/^http:\/\/localhost/);
  });
});

describe('Claude request', () => {
  it('Opus 5.5: no sampling parameters, effort, thinking headroom and refusal fallbacks', () => {
    const r = buildClaudeRequest({ model: 'claude-opus-5-5', ...msg, maxTokens: 512, temperature: 0.7, effort: 'medium' });
    expect(r.temperature).toBeUndefined();
    expect(r.top_p).toBeUndefined();
    expect(r.output_config).toEqual({ effort: 'medium' });
    expect(r.max_tokens).toBeGreaterThan(512);
    expect(r.system).toBe('sys');
    expect(r.messages).toEqual([{ role: 'user', content: msg.messages[1].content }]);
    expect(r.betas).toEqual([FALLBACK_BETA]);
    expect(r.fallbacks).toBe('default');
  });
  it('Sonnet 5.5 behaves the same; Haiku 4.5 takes temperature and no fallbacks', () => {
    expect(buildClaudeRequest({ model: 'claude-sonnet-5-5', ...msg }).fallbacks).toBe('default');
    const h = buildClaudeRequest({ model: 'claude-haiku-4-5', ...msg, temperature: 0 });
    expect(h.temperature).toBe(0);
    expect(h.output_config).toBeUndefined();
    expect(h.fallbacks).toBeUndefined();
  });
  it('merges turns so roles alternate and the last turn is the user', () => {
    const r = buildClaudeRequest({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: 's' },
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'u1' },
        { role: 'user', content: 'u2' },
      ],
    });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.messages[2].content).toBe('u1\n\nu2');
  });
  it('maps refusals and network failures to clear messages', () => {
    expect(friendlyError('refusal', 'cyber', { provider: 'anthropic' }).title).toMatch(/declined/);
    expect(friendlyError(401, '', { provider: 'anthropic' }).hint).toMatch(/console\.anthropic\.com/);
  });
});
