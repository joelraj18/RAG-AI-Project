import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeAccount, friendlyError, callsPerQuestion, estimateLabCalls, isLargeModel, PLAN_DEFAULTS } from '../hf.js';
import { generate, hfModelId, LLMError } from '../llm.js';
import { getUsage } from '../usage.js';
import { DEFAULT_SETTINGS, BENCH_CONFIGS } from '../settings.js';

const sse = (text) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const hf = { ...DEFAULT_SETTINGS, provider: 'hf', hfToken: 'hf_abc' };
const msg = { messages: [{ role: 'user', content: 'hi' }] };

afterEach(() => vi.unstubAllGlobals());

describe('account detection', () => {
  it('detects PRO vs free and missing inference permission', () => {
    expect(describeAccount({ name: 'a', isPro: true, auth: { accessToken: { role: 'read' } } })).toMatchObject({ plan: 'pro', inferencePermission: true });
    const fg = describeAccount({ name: 'b', isPro: false, auth: { accessToken: { role: 'fineGrained', fineGrained: { global: [], scoped: [{ permissions: ['repo.content.read'] }] } } } });
    expect(fg).toMatchObject({ plan: 'free', inferencePermission: false });
    const ok = describeAccount({ name: 'c', auth: { accessToken: { role: 'fineGrained', fineGrained: { global: ['inference.serverless.write'] } } } });
    expect(ok.inferencePermission).toBe(true);
  });
});

describe('plan guidance', () => {
  it('estimates calls per question and per lab run', () => {
    expect(callsPerQuestion({ ...DEFAULT_SETTINGS, provider: 'hf', ...PLAN_DEFAULTS.free.values })).toEqual({ base: 2, worst: 2 });
    const pro = callsPerQuestion({ ...DEFAULT_SETTINGS, provider: 'hf', ...PLAN_DEFAULTS.pro.values });
    expect(pro.base).toBe(3);
    expect(pro.worst).toBe(7);
    expect(callsPerQuestion({ ...DEFAULT_SETTINGS, provider: 'extractive' }).base).toBe(0);
    const s = { ...hf, judgeMode: 'combined' };
    expect(estimateLabCalls(s, BENCH_CONFIGS.slice(0, 3), 5, false)).toBe(30);
    expect(estimateLabCalls(s, BENCH_CONFIGS, 5, true)).toBe(0);
  });
  it('flags large models', () => {
    expect(isLargeModel('meta-llama/Llama-3.3-70B-Instruct')).toBe(true);
    expect(isLargeModel('Qwen/Qwen2.5-72B-Instruct:fastest')).toBe(true);
    expect(isLargeModel('meta-llama/Llama-3.1-8B-Instruct')).toBe(false);
  });
  it('maps router errors to actionable messages', () => {
    expect(friendlyError(402).billing).toBe(true);
    expect(friendlyError(400, 'You have exceeded your monthly included credits').billing).toBe(true);
    expect(friendlyError(403, 'Access to model meta-llama/x is restricted', { model: 'meta-llama/x' }).hint).toMatch(/accept the licence/);
    expect(friendlyError(403, 'forbidden').hint).toMatch(/Make calls to Inference Providers/);
    expect(friendlyError(400, 'Model not supported by provider', { model: 'x/y' }).title).toBe('Model not available');
    expect(friendlyError(401).title).toBe('Token rejected');
  });
});

describe('Hugging Face client', () => {
  it('retries rate limits, then succeeds, and counts usage once', async () => {
    const before = getUsage().visit.calls;
    const fetch = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '0.01' } })).mockResolvedValueOnce(sse('ok'));
    vi.stubGlobal('fetch', fetch);
    const r = await generate(hf, { ...msg, purpose: 'judge' });
    expect(r.text).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getUsage().visit.calls).toBe(before + 1);
    expect(getUsage().visit.byPurpose.judge.calls).toBeGreaterThan(0);
  });
  it('does not retry when credits are exhausted and explains why', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'You have exceeded your monthly included credits' }), { status: 402 }));
    vi.stubGlobal('fetch', fetch);
    const err = await generate(hf, msg).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.billing).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries without stream_options only when the server rejects that field', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('unknown field stream_options', { status: 400 })).mockResolvedValueOnce(sse('ok'));
    vi.stubGlobal('fetch', fetch);
    await generate({ ...hf, provider: 'custom', openaiBaseUrl: 'http://x/v1' }, msg);
    expect(JSON.parse(fetch.mock.calls[1][1].body).stream_options).toBeUndefined();
    const fetch2 = vi.fn().mockResolvedValue(new Response('{"error":"Model not supported"}', { status: 400 }));
    vi.stubGlobal('fetch', fetch2);
    await generate(hf, msg).catch(() => {});
    expect(fetch2).toHaveBeenCalledTimes(1);
  });
  it('sends provider policy and organisation billing header', async () => {
    const fetch = vi.fn().mockResolvedValue(sse('ok'));
    vi.stubGlobal('fetch', fetch);
    await generate({ ...hf, hfPolicy: 'cheapest', hfBillTo: 'my-org' }, msg);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://router.huggingface.co/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('meta-llama/Llama-3.1-8B-Instruct:cheapest');
    expect(init.headers['X-HF-Bill-To']).toBe('my-org');
    expect(init.headers.Authorization).toBe('Bearer hf_abc');
    expect(hfModelId({ hfModel: 'a/b:fastest', hfPolicy: 'cheapest' })).toBe('a/b:fastest');
  });
  it('rejects tokens that are not Hugging Face tokens before any request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const err = await generate({ ...hf, hfToken: 'sk-wrong' }, msg).catch((e) => e);
    expect(err.title).toBe('Token rejected');
    expect(fetch).not.toHaveBeenCalled();
  });
});
