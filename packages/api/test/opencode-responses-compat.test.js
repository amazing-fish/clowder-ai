import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateOpenCodeRuntimeConfig } from '../dist/domains/cats/services/agents/providers/opencode-config-template.js';

const endpoint = 'https://discovery-api.intern-ai.org.cn/v1/responses';

async function configuredFetch(baseURL = endpoint.replace('/responses', ''), npm = '@ai-sdk/openai') {
  const config = generateOpenCodeRuntimeConfig({
    providerName: 'openai-responses',
    models: ['Atria-Dawn-Preview'],
    apiType: 'openai-responses',
    hasBaseUrl: true,
  });
  assert.equal(config.plugin?.length, 1, 'custom Responses must load the bundled compatibility plugin');
  const plugin = (await import(config.plugin[0])).default;
  const calls = [];
  const response = new Response('data: sentinel\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const originalFetch = async (...args) => {
    calls.push(args);
    return response;
  };
  const provider = { npm, options: { baseURL, fetch: originalFetch } };
  await (await plugin()).config({ provider: { custom: provider } });
  return { fetch: provider.options.fetch, calls, response, originalFetch };
}

test('Responses continuation adds the message discriminator while preserving tool/reasoning history', async () => {
  const ctx = await configuredFetch();
  const input = [
    { role: 'system', content: 'System' },
    { role: 'user', content: [{ type: 'input_text', text: 'Read a file' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'Checking' }] },
    { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 'Plan' }] },
    { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'Contents' },
    {
      type: 'message',
      role: 'assistant',
      id: 'msg_1',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Done' }],
    },
  ];
  const body = { model: 'Atria-Dawn-Preview', input, stream: true, store: false };
  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { authorization: 'Bearer test-only' },
    signal: new AbortController().signal,
  };
  assert.equal(await ctx.fetch(endpoint, init), ctx.response, 'do not buffer or replace SSE response');
  const sent = JSON.parse(ctx.calls[0][1].body);
  const expected = structuredClone(body);
  expected.input[2].type = 'message';
  assert.deepEqual(sent, expected);
  assert.equal(ctx.calls[0][1].headers, init.headers);
  assert.equal(ctx.calls[0][1].signal, init.signal);
  assert.equal(init.body, JSON.stringify(body), 'do not mutate caller init');
});

test('compatibility leaves other hosts, protocols, and paths untouched', async () => {
  for (const base of [
    'https://api.openai.com/v1',
    'https://discovery-api.intern-ai.org.cn.evil.test/v1',
    'http://discovery-api.intern-ai.org.cn/v1',
  ]) {
    const ctx = await configuredFetch(base);
    assert.equal(ctx.fetch, ctx.originalFetch);
  }
  const chat = await configuredFetch(endpoint.replace('/responses', ''), '@ai-sdk/openai-compatible');
  assert.equal(chat.fetch, chat.originalFetch);
  const ctx = await configuredFetch();
  const init = { method: 'POST', body: '{"input":[{"role":"assistant","content":[]}]}' };
  await ctx.fetch('https://discovery-api.intern-ai.org.cn/v1/chat/completions', init);
  assert.equal(ctx.calls[0][1], init);
  await ctx.fetch('https://elsewhere.test/v1/responses', init);
  assert.equal(ctx.calls[1][1], init);
});

test('fresh input, explicit types, malformed JSON, and non-JSON bodies pass through unchanged', async () => {
  const ctx = await configuredFetch();
  for (const body of [
    '{"input":"hello"}',
    '{"input":[{"role":"user","content":"hello"}]}',
    '{"input":[{"role":"assistant","content":"hello"}]}',
    '{"input":[{"type":"message","role":"assistant","content":[]}]}',
    '{',
    new Uint8Array([1, 2]),
  ]) {
    const init = { method: 'POST', body };
    await ctx.fetch(endpoint, init);
    assert.equal(ctx.calls.at(-1)[1], init);
  }
});

test('only custom Responses configs request the plugin', () => {
  for (const options of [
    { apiType: 'openai' },
    { apiType: 'anthropic' },
    { apiType: 'openai-responses', hasBaseUrl: false },
    { apiType: 'openai-responses', mcpOnly: true },
    { apiType: 'openai-responses', omitProviderAuth: true },
  ]) {
    const config = generateOpenCodeRuntimeConfig({
      providerName: 'test',
      models: ['model'],
      hasBaseUrl: true,
      ...options,
    });
    assert.equal(config.plugin, undefined);
  }
});
