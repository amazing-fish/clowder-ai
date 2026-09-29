import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { AcpClient } from '../../dist/domains/cats/services/agents/providers/acp/AcpClient.js';
import { AcpHttpStreamClient } from '../../dist/domains/cats/services/agents/providers/acp/AcpHttpStreamClient.js';

const sessionId = 'wait-state-test';
const tool = (id, status, sessionUpdate = 'tool_call') => ({ sessionUpdate, toolCallId: id, status });
const text = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'still working' } };
const permission = (id) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method: 'session/request_permission',
  params: { sessionId, options: [{ optionId: 'yes', kind: 'allow_once' }] },
});

// Exercise real stream parsers and watchdogs, replacing only the agent process.
async function openTransport(t, transport, permissionHandler, responseStatus = 200) {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      this.killed = true;
      this.stdout.end();
      this.stderr.end();
      this.emit('exit', 0, null);
      return true;
    },
  });
  let emit;
  let promptId;
  let promptResponse;
  let promptStarted;
  let started = new Promise((resolve) => {
    promptStarted = resolve;
  });
  const requests = [];
  const responses = [];
  let onCancel;
  const cancelled = new Promise((resolve) => {
    onCancel = resolve;
  });
  function handle(msg, send, res) {
    requests.push(msg);
    if (msg.method === 'session/cancel') {
      onCancel();
      return;
    }
    if (!msg.method) {
      responses.push(msg);
      if (transport === 'http') send({});
      return;
    }
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    } else if (msg.method === 'session/prompt') {
      promptId = msg.id;
      promptResponse = res;
      emit = send;
      promptStarted();
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
  }
  let server;
  if (transport === 'http') {
    server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const msg = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(msg.method ? 200 : responseStatus, { 'Content-Type': 'application/x-ndjson' });
      const send = (value) => res.write(`${JSON.stringify(value)}\n`);
      handle(msg, send, res);
      if (msg.method !== 'session/prompt') res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  } else {
    child.stdin.on('data', (chunk) => {
      for (const line of chunk.toString().trim().split('\n')) {
        handle(JSON.parse(line), (value) => setImmediate(() => child.stdout.write(`${JSON.stringify(value)}\n`)));
      }
    });
  }
  const Client = transport === 'http' ? AcpHttpStreamClient : AcpClient;
  const client = new Client({
    command: 'fake-acp',
    args: [],
    cwd: process.cwd(),
    permissionHandler,
    spawnFn: () => {
      if (server) setImmediate(() => child.stdout.write(`Listening on port ${server.address().port}\n`));
      return child;
    },
  });
  t.after(async () => {
    promptResponse?.end();
    await client.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  await client.initialize();
  return {
    requests,
    responses,
    cancelled,
    async start() {
      const ready = started;
      const iterator = client.promptStream(sessionId, 'test', { idleWarningMs: 25, idleStallMs: 150, timeoutMs: 3000 });
      const first = iterator.next();
      await ready;
      return { iterator, first };
    },
    send(value) {
      emit(value);
    },
    update(update, flat = false) {
      emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, ...(flat ? update : { update }) } });
    },
    finish() {
      emit({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
      promptResponse?.end();
      started = new Promise((resolve) => {
        promptStarted = resolve;
      });
    },
  };
}

async function nextWarning(stream) {
  let result = await stream.first;
  stream.first = undefined;
  for (;;) {
    if (result) {
      assert.equal(result.done, false, 'prompt ended before watchdog warning');
      const kind = (result.value.update ?? result.value).sessionUpdate;
      if (kind === 'stream_idle_warning' || kind === 'stream_tool_wait_warning') return kind;
    }
    result = await stream.iterator.next();
  }
}

for (const transport of ['stdio', 'http']) {
  describe(`${transport} tool wait lifecycle`, () => {
    for (const flat of [false, true]) {
      for (const status of ['completed', 'failed']) {
        for (const finalKind of ['tool_call', 'tool_call_update']) {
          it(`${flat ? 'flat' : 'nested'} ${finalKind} ${status} settles only its tool`, async (t) => {
            const h = await openTransport(t, transport);
            const stream = await h.start();
            if (finalKind === 'tool_call_update') h.update(tool('a', 'in_progress'), flat);
            h.update(tool('a', status, finalKind), flat);
            assert.equal(await nextWarning(stream), 'stream_idle_warning');
            h.finish();
            for await (const _ of stream.iterator) {
              /* drain */
            }
          });
        }
      }
    }
    const scenarios = [
      [
        'concurrent tool survives text and another final',
        [tool('a', 'in_progress'), tool('b', 'in_progress'), text, tool('a', 'completed', 'tool_call_update')],
        true,
      ],
      ['first-observed progress remains pending', [tool('b', undefined, 'tool_call_update')], true],
      [
        'metadata preserves identified tool',
        [tool('a', 'in_progress'), { sessionUpdate: 'current_mode_update' }],
        true,
      ],
      ['thought preserves identified tool', [tool('a', 'in_progress'), { sessionUpdate: 'agent_thought_chunk' }], true],
      ['final replay cannot reopen tool', [tool('a', 'completed'), tool('a', 'pending')], false],
      [
        'anonymous final cannot clear identified tool',
        [tool('a', 'in_progress'), tool(undefined, 'completed', 'tool_call_update')],
        true,
      ],
      ['legacy anonymous tool can finish on text', [tool(undefined, undefined), text], false],
    ];
    for (const [name, updates, pending] of scenarios) {
      it(name, async (t) => {
        const h = await openTransport(t, transport);
        const stream = await h.start();
        for (const update of updates) h.update(update);
        assert.equal(await nextWarning(stream), pending ? 'stream_tool_wait_warning' : 'stream_idle_warning');
        await assert.rejects(
          async () => {
            for await (const _ of stream.iterator) {
              /* drain to TTL */
            }
          },
          (error) => error.code === 'STREAM_IDLE_STALL' && error.configuredIdleStallMs === 150,
        );
        await h.cancelled;
        assert.ok(h.requests.some((msg) => msg.method === 'session/cancel'));
      });
    }
    for (const id of [0, 'permission-a', undefined]) {
      it(`synchronous approval leaves no stale permission (${id})`, async (t) => {
        const h = await openTransport(t, transport);
        const stream = await h.start();
        h.send(permission(id));
        assert.equal(await nextWarning(stream), 'stream_idle_warning');
        assert.ok(h.responses.some((msg) => msg.result?.outcome?.outcome === 'selected'));
        h.finish();
        for await (const _ of stream.iterator) {
          /* drain */
        }
      });
    }
    it('permission decisions settle individually and preserve running tools', async (t) => {
      const decisions = new Map();
      const h = await openTransport(t, transport, (req, respond) => decisions.set(String(req.id), respond));
      const stream = await h.start();
      h.send(permission('p1'));
      h.send(permission('p2'));
      h.update(text);
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      decisions.get('p1')({ optionId: 'yes' });
      h.update(text);
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      h.update(tool('a', 'in_progress'));
      decisions.get('p2')({ optionId: 'yes' });
      h.update(text);
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      h.update(tool('a', 'completed', 'tool_call_update'));
      assert.equal(await nextWarning(stream), 'stream_idle_warning');
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
    });
    it('handler error clears permission wait', async (t) => {
      const h = await openTransport(t, transport, () => {
        throw new Error('test denial');
      });
      const stream = await h.start();
      h.send(permission(undefined));
      assert.equal(await nextWarning(stream), 'stream_idle_warning');
      assert.ok(h.responses.some((msg) => msg.error?.code === -32603));
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
    });
    it('next prompt does not inherit running tools or final IDs', async (t) => {
      const h = await openTransport(t, transport);
      let stream = await h.start();
      h.update(tool('a', 'completed'));
      h.update(tool('b', 'in_progress'));
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
      stream = await h.start();
      h.update(text);
      assert.equal(await nextWarning(stream), 'stream_idle_warning');
      h.update(tool('a', 'in_progress'));
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
    });
    it('late decision cannot settle a reused permission ID in the next prompt', async (t) => {
      const decisions = [];
      const h = await openTransport(t, transport, (_req, respond) => decisions.push(respond));
      let stream = await h.start();
      h.send(permission('reused'));
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
      stream = await h.start();
      h.send(permission('reused'));
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      decisions[0]({ optionId: 'yes' });
      h.update(text);
      assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
      decisions[1]({ optionId: 'yes' });
      assert.equal(await nextWarning(stream), 'stream_idle_warning');
      h.finish();
      for await (const _ of stream.iterator) {
        /* drain */
      }
    });
  });
}

it('late HTTP permission response failure rejects the owning prompt', async (t) => {
  let decide;
  const h = await openTransport(
    t,
    'http',
    (_req, respond) => {
      decide = respond;
    },
    503,
  );
  const stream = await h.start();
  h.send(permission('p1'));
  assert.equal(await nextWarning(stream), 'stream_tool_wait_warning');
  decide({ optionId: 'yes' });
  await assert.rejects(async () => {
    for await (const _ of stream.iterator) {
      /* drain */
    }
  }, /ACP HTTP agent response 503/);
});
