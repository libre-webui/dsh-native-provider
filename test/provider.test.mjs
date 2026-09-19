/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at:
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, {
  LlmAdapter,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';

import * as plugin from '../dist/native-provider-plugin.js';
import * as protocol from '../dist/native-provider-protocol.js';

const providerId = 'deepseek-official';
const rawRequest = (model = 'deepseek-flash') => ({
  provider: providerId,
  model,
  messages: [
    createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'hello' }],
    }),
  ],
});

async function fixture(options = {}) {
  const directory = await realpath(await mkdtemp('/tmp/lw-native-'));
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, 'provider.sock');
  const ctx = new Context();
  const calls = [];
  await ctx.plugin(LlmRuntime);
  class Adapter extends LlmAdapter {
    providerInfo(id) {
      return { id, name: 'Native DeepSeek' };
    }
    async listModels(provider) {
      return [
        { provider, id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
        { provider, id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ];
    }
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        context: { contextWindow: 32768 },
        defaultMaxTokens: 4096,
        reasoning: {
          efforts: [
            { id: 'none', name: 'Off' },
            { id: 'high', name: 'High' },
          ],
          defaultEffort: 'high',
        },
      };
    }
    async *stream(call) {
      calls.push(call);
      const last = call.messages.at(-1);
      const input = last?.content.find(block => block.type === 'text')?.text;
      if (input === 'wait') {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'waiting' };
        await new Promise((resolve, reject) => {
          const abort = () => reject(call.signal.reason);
          call.signal.addEventListener('abort', abort, { once: true });
          if (call.signal.aborted) abort();
        });
        return;
      }
      const toolResult = last?.content.find(
        block => block.type === 'tool-result'
      );
      if (call.tools?.length && !toolResult && !call.purpose) {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield {
          type: 'reasoning-delta',
          index: 0,
          text: 'Read the Work file.',
        };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'reasoning', text: 'Read the Work file.' },
        };
        yield { type: 'block-start', index: 1, blockType: 'tool-call' };
        yield {
          type: 'tool-call-delta',
          index: 1,
          id: 'work-call',
          name: 'read_file',
          argumentsDelta: '{"path":"notes.txt"}',
        };
        yield {
          type: 'block-end',
          index: 1,
          block: {
            type: 'tool-call',
            id: 'work-call',
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
          },
        };
        yield {
          type: 'usage',
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            cacheReadTokens: 4,
            totalTokens: 9,
          },
        };
        yield {
          type: 'finish',
          reason: { kind: 'tool-calls' },
          replayState: { response: { opaque: 'native-signed-fixture' } },
        };
        return;
      }
      const text =
        call.purpose === 'session-title'
          ? 'Native model title'
          : toolResult
            ? `Used ${toolResult.content[0].text}`
            : `Answer from ${call.model}`;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter([providerId], new Adapter());
  ctx.llm.registerConfigurableProviders([
    {
      provider: providerId,
      displayName: 'Native DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
    },
  ]);
  const fiber = ctx.plugin(plugin, {
    socketPath,
    requestTimeoutMs: 2000,
    ...options,
  });
  await fiber;
  return {
    ctx,
    fiber,
    socketPath,
    directory,
    calls,
    async close() {
      await ctx.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function request(socketPath, endpoint, body, headers = {}) {
  const bytes = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        method: 'POST',
        path: endpoint,
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bytes),
          ...headers,
        },
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          text += chunk;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
          })
        );
        response.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

function chunks(response) {
  return response.text
    .trim()
    .split('\n')
    .map(line => protocol.parseNativeProviderChunk(JSON.parse(line)));
}

test('private native socket advertises configured models and only mounts the LLM service', async () => {
  const item = await fixture();
  try {
    assert.equal((await lstat(item.directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(item.socketPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(item.socketPath)).uid, process.getuid());
    assert.equal(item.ctx.get('agents'), undefined);
    assert.equal(item.ctx.get('sessions'), undefined);
    assert.equal(item.ctx.get('tools'), undefined);
    const response = await request(item.socketPath, '/catalog', {});
    assert.equal(response.status, 200);
    const catalog = protocol.parseNativeProviderCatalog(
      JSON.parse(response.text)
    );
    assert.deepEqual(
      catalog.models.map(model => model.name),
      ['DeepSeek-V41-Flash', 'DeepSeek-V4-Pro']
    );
    assert.equal(catalog.models[0].providerId, providerId);
    assert.equal(catalog.models[0].contextWindow, 32768);
    assert.equal(catalog.models[0].reasoning.defaultEffort, 'high');
    assert.equal(
      response.headers[protocol.NATIVE_PROVIDER_INSTANCE_HEADER],
      catalog.instanceId
    );
    assert.equal(item.calls.length, 0);
  } finally {
    await item.close();
  }
});

test('native generation validates only its selected provider and exact model metadata', async () => {
  const item = await fixture({ requestTimeoutMs: 100 });
  let unrelatedCatalogCalls = 0;
  const resolvedModels = [];
  const originalResolve = item.ctx.llm.resolveModelInfo.bind(item.ctx.llm);
  class UnrelatedAdapter extends LlmAdapter {
    providerInfo(id) {
      return { id, name: 'Unrelated unavailable provider' };
    }
    async listModels() {
      unrelatedCatalogCalls += 1;
      return new Promise(() => {});
    }
    async resolveModel() {
      assert.fail('unrelated metadata must not be resolved');
    }
    async *stream() {
      assert.fail('unrelated provider must not generate');
    }
  }
  item.ctx.llm.registerAdapter(['unrelated-provider'], new UnrelatedAdapter());
  item.ctx.llm.resolveModelInfo = (provider, model, signal) => {
    resolvedModels.push(model);
    if (model !== 'deepseek-flash') return new Promise(() => {});
    return originalResolve(provider, model, signal);
  };
  try {
    const response = await request(item.socketPath, '/generate', rawRequest());
    assert.equal(response.status, 200);
    assert.equal(chunks(response).at(-1).reason.kind, 'stop');
    assert.deepEqual(resolvedModels, ['deepseek-flash']);
    assert.equal(unrelatedCatalogCalls, 0);
    assert.equal(item.calls.length, 1);
    assert.equal(
      (await request(item.socketPath, '/generate', rawRequest('missing')))
        .status,
      422
    );
    assert.equal(
      item.calls.length,
      1,
      'unknown models must not reach generation'
    );
    assert.equal(unrelatedCatalogCalls, 0);
  } finally {
    item.ctx.llm.resolveModelInfo = originalResolve;
    await item.close();
  }
});

test('native metadata resolution receives cancellation when its request times out', async () => {
  const item = await fixture({ requestTimeoutMs: 30 });
  const originalResolve = item.ctx.llm.resolveModelInfo;
  let metadataSignal;
  let metadataAborted = false;
  item.ctx.llm.resolveModelInfo = (_provider, _model, signal) => {
    metadataSignal = signal;
    return new Promise((resolve, reject) => {
      const abort = () => {
        metadataAborted = true;
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  };
  try {
    const response = await request(item.socketPath, '/generate', rawRequest());
    assert.equal(response.status, 504);
    assert.equal(metadataSignal?.aborted, true);
    assert.equal(metadataAborted, true);
    assert.equal(item.calls.length, 0);
  } finally {
    item.ctx.llm.resolveModelInfo = originalResolve;
    await item.close();
  }
});

test('native request schema rejects cross-service fields, file capabilities and oversized bodies', async () => {
  const item = await fixture();
  try {
    const valid = rawRequest();
    for (const extra of [
      { sessionId: 'other-session' },
      { agents: [] },
      { signal: {} },
      { purpose: 'execute-tools' },
    ]) {
      assert.equal(
        (await request(item.socketPath, '/generate', { ...valid, ...extra }))
          .status,
        400
      );
    }
    const file = structuredClone(valid);
    file.messages[0].content = [
      { type: 'file', attachment: { id: 'private-native-file' } },
    ];
    assert.equal(
      (await request(item.socketPath, '/generate', file)).status,
      400
    );
    assert.equal(
      (
        await request(item.socketPath, '/generate', valid, {
          'content-length': protocol.MAX_REQUEST_BYTES + 1,
        })
      ).status,
      413
    );
    assert.equal(
      (await request(item.socketPath, '/catalog', { keys: true })).status,
      400
    );
    assert.equal(item.calls.length, 0);
  } finally {
    await item.close();
  }
});

test('native streams preserve failure/max-token/usage vocabulary and reject missing finish', async () => {
  const item = await fixture();
  const original = item.ctx.llm.stream;
  try {
    for (const reason of [
      { kind: 'max-tokens' },
      {
        kind: 'error',
        failure: {
          code: 'RATE_LIMIT',
          message: 'Try later',
          status: 429,
          providerRetryAfterMs: 2000,
        },
      },
    ]) {
      item.ctx.llm.stream = async function* () {
        yield {
          type: 'usage',
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 3,
            cacheWriteTokens: 4,
            reasoningTokens: 1,
            totalTokens: 10,
          },
        };
        yield { type: 'finish', reason };
      };
      const received = chunks(
        await request(item.socketPath, '/generate', rawRequest())
      );
      assert.deepEqual(received.at(-1).reason, reason);
      assert.equal(received[0].usage.cacheWriteTokens, 4);
    }
    item.ctx.llm.stream = async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'unfinished' };
    };
    const received = chunks(
      await request(item.socketPath, '/generate', rawRequest())
    );
    assert.equal(received.at(-1).reason.kind, 'error');
    assert.equal(
      received.at(-1).reason.failure.code,
      'NATIVE_PROVIDER_STREAM_FAILED'
    );
  } finally {
    item.ctx.llm.stream = original;
    await item.close();
  }
});

test('unsafe socket directories and occupied paths are refused without replacing files', async () => {
  const directory = await realpath(await mkdtemp('/tmp/lw-native-bad-'));
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      plugin.apply(ctx, { socketPath: path.join(directory, 'provider.sock') }),
      /0700/
    );
    await chmod(directory, 0o700);
    const existing = path.join(directory, 'existing.sock');
    await writeFile(existing, 'keep this file');
    await assert.rejects(
      plugin.apply(ctx, { socketPath: existing }),
      /already exists/
    );
    assert.equal(await readFile(existing, 'utf8'), 'keep this file');
    const linked = path.join(directory, 'linked');
    await symlink(directory, linked);
    await assert.rejects(
      plugin.apply(ctx, { socketPath: path.join(linked, 'provider.sock') }),
      /symbolic links/
    );
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('native request timeout terminates a stalled provider and permits plugin cleanup', async () => {
  const item = await fixture({ requestTimeoutMs: 30 });
  const original = item.ctx.llm.stream;
  let signal;
  item.ctx.llm.stream = async function* (call) {
    signal = call.signal;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'stalled' };
    await new Promise(() => {});
  };
  try {
    const response = await request(item.socketPath, '/generate', rawRequest());
    assert.equal(response.status, 200);
    assert.equal(chunks(response).at(-1).reason.kind, 'error');
    assert.equal(signal.aborted, true);
    await item.fiber.dispose();
    await assert.rejects(lstat(item.socketPath), { code: 'ENOENT' });
  } finally {
    item.ctx.llm.stream = original;
    await item.close();
  }
});

async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await delay(5);
  }
  assert.fail('fixture condition did not become true');
}

test('catalog generations reject stale selections and provider changes abort active streams', async () => {
  const item = await fixture();
  try {
    const first = JSON.parse(
      (await request(item.socketPath, '/catalog', {})).text
    );
    item.ctx.emit('credentials/reference-updated', 'fixture-key');
    const second = JSON.parse(
      (await request(item.socketPath, '/catalog', {})).text
    );
    assert.notEqual(first.instanceId, second.instanceId);
    const stale = await request(item.socketPath, '/generate', {
      ...rawRequest(),
      instanceId: first.instanceId,
    });
    assert.equal(stale.status, 409);
    assert.equal(item.calls.length, 0);
    const waiting = structuredClone(rawRequest());
    waiting.messages[0].content[0].text = 'wait';
    const responsePromise = request(item.socketPath, '/generate', {
      ...waiting,
      instanceId: second.instanceId,
    });
    await waitFor(() => item.calls.length === 1);
    item.ctx.emit('settings/updated', 'ui-theme', {}, {}, 'update');
    item.ctx.emit('settings/document-updated', 'llm-deepseek', 2);
    assert.equal(item.calls[0].signal.aborted, false);
    item.ctx.emit('settings/updated', 'llm-deepseek', {}, {}, 'update');
    const response = await responsePromise;
    assert.equal(
      chunks(response).at(-1).reason.failure.code,
      'NATIVE_PROVIDER_CHANGED'
    );
    assert.equal(item.calls[0].signal.aborted, true);
  } finally {
    await item.close();
  }
});

test('disconnecting a reader cancels native generation and disposal removes the owned socket', async () => {
  const item = await fixture();
  try {
    const body = structuredClone(rawRequest());
    body.messages[0].content[0].text = 'wait';
    await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath: item.socketPath,
          method: 'POST',
          path: '/generate',
          headers: { 'content-type': 'application/json' },
        },
        response => {
          response.on('error', () => {});
          response.once('data', () => {
            req.destroy();
            resolve();
          });
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    await waitFor(() => item.calls[0]?.signal.aborted);
    await item.fiber.dispose();
    await assert.rejects(lstat(item.socketPath), { code: 'ENOENT' });
  } finally {
    await item.close();
  }
});

test('request capacity rejects excess work and becomes available after cancellation', async () => {
  const item = await fixture({ maxConcurrentRequests: 1 });
  try {
    const waiting = structuredClone(rawRequest());
    waiting.messages[0].content[0].text = 'wait';
    const pending = request(item.socketPath, '/generate', waiting);
    await waitFor(() => item.calls.length === 1);
    assert.equal(
      (await request(item.socketPath, '/generate', rawRequest())).status,
      503
    );
    assert.equal(item.calls.length, 1);
    item.ctx.emit('llm/adapters-updated');
    await pending;
    const next = await request(item.socketPath, '/generate', rawRequest());
    assert.equal(next.status, 200);
    assert.equal(chunks(next).at(-1).reason.kind, 'stop');
    assert.equal(item.calls.length, 2);
  } finally {
    await item.close();
  }
});

test('text auxiliary calls expose no native agent or tool executor', async () => {
  const item = await fixture();
  try {
    const response = await request(item.socketPath, '/generate', {
      ...rawRequest(),
      purpose: 'session-title',
    });
    assert.equal(response.status, 200);
    assert.equal(
      chunks(response).find(chunk => chunk.type === 'text-delta').text,
      'Native model title'
    );
    assert.equal(item.calls[0].purpose, 'session-title');
    assert.equal(item.calls[0].tools, undefined);
    assert.equal(item.calls[0].sessionId, undefined);
    assert.equal(item.ctx.get('agents'), undefined);
    assert.equal(item.ctx.get('sessions'), undefined);
    assert.equal(item.ctx.get('tools'), undefined);
  } finally {
    await item.close();
  }
});

test('protocol validation bounds schemas and rejects invalid usage and tool correlation', () => {
  const tool = {
    name: 'read_file',
    description: 'Fixture only',
    parameters: { type: 'object' },
  };
  assert.throws(
    () =>
      protocol.parseNativeProviderRequest({
        ...rawRequest(),
        tools: [tool, tool],
      }),
    /duplicate tool/
  );
  let nested = {};
  for (let depth = 0; depth < 40; depth++) nested = { next: nested };
  assert.throws(
    () =>
      protocol.parseNativeProviderRequest({
        ...rawRequest(),
        tools: [{ ...tool, parameters: nested }],
      }),
    /complexity/
  );
  assert.throws(
    () =>
      protocol.parseNativeProviderChunk({
        type: 'usage',
        usage: { inputTokens: 0.5, outputTokens: 1 },
      }),
    /token usage/
  );
  const correlated = structuredClone(rawRequest());
  correlated.messages[0].source = { kind: 'tool', callId: 'one' };
  correlated.messages[0].content = [
    {
      type: 'tool-result',
      toolCallId: 'two',
      content: [{ type: 'text', text: 'result' }],
    },
  ];
  assert.throws(
    () => protocol.parseNativeProviderRequest(correlated),
    /correlation/
  );
});
