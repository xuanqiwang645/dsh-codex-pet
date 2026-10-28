import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import test from 'node:test';
import { CodexClient, remainingPercent, type SpawnCodex } from './client.ts';
import { createCodexAi } from './index.ts';

type Message = Record<string, unknown>;
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  sent: Message[] = [];
  killed = false;
  stdin: Writable;
  handler?: (message: Message) => void;
  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        for (const line of String(chunk).trim().split('\n')) {
          const message = JSON.parse(line) as Message;
          this.sent.push(message);
          queueMicrotask(() => this.handler?.(message));
        }
        callback();
      },
    });
  }
  incoming(message: Message): void {
    this.stdout.write(JSON.stringify(message) + '\n');
  }
  reply(message: Message, result: unknown): void {
    this.incoming({ id: message.id, result });
  }
  kill(): boolean {
    this.killed = true;
    this.emit('close', 0);
    return true;
  }
}
function fixture(options: { hangAccount?: boolean; chat?: boolean; wrongProfile?: boolean; mcpName?: string } = {}) {
  const child = new FakeChild();
  const launches: string[][] = [];
  let turnStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    turnStarted = resolve;
  });
  child.handler = (message) => {
    switch (message.method) {
      case 'initialize':
        child.reply(message, {});
        break;
      case 'account/read':
        if (!options.hangAccount)
          child.reply(message, {
            account: { type: 'chatgpt', planType: 'plus', email: 'not-for-the-pet@example.test' },
          });
        break;
      case 'model/list':
        child.reply(message, {
          data: [
            {
              model: 'model-from-catalog',
              displayName: 'Catalog Default',
              isDefault: true,
              supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
            },
          ],
          nextCursor: null,
        });
        break;
      case 'account/rateLimits/read':
        child.reply(message, { rateLimits: { primary: { usedPercent: 42 } } });
        break;
      case 'config/read':
        child.reply(message, {
          config: {
            mcp_servers: {
              [options.mcpName ?? 'private_connector']: { command: 'ignored', env: { SECRET: 'never-copy-this' } },
            },
            plugins: { 'example@source': { enabled: true } },
          },
        });
        break;
      case 'thread/start':
        child.reply(message, {
          thread: { id: 'pet-thread' },
          activePermissionProfile: { id: options.wrongProfile ? ':danger-full-access' : 'dsh-pet-chat' },
          sandbox: { type: 'readOnly', networkAccess: false },
          approvalPolicy: 'never',
        });
        break;
      case 'turn/start':
        child.reply(message, { turn: { id: 'pet-turn' } });
        turnStarted?.();
        if (options.chat)
          queueMicrotask(() => {
            child.incoming({ method: 'item/agentMessage/delta', params: { threadId: 'pet-thread', delta: '你好，' } });
            child.incoming({
              method: 'item/agentMessage/delta',
              params: { threadId: 'pet-thread', delta: '我在这里。' },
            });
            child.incoming({
              method: 'turn/completed',
              params: { threadId: 'pet-thread', turn: { id: 'pet-turn', status: 'completed' } },
            });
          });
        break;
      case 'thread/unsubscribe':
      case 'turn/interrupt':
        child.reply(message, {});
        break;
    }
  };
  const spawn: SpawnCodex = (_command, args) => {
    launches.push(args);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const home = mkdtempSync(join(tmpdir(), 'dsh-codex-adapter-'));
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return { child, spawn, launches, home, logger, started };
}

test('quota/account transport strips personal account fields and discovers the real catalog default', async () => {
  const f = fixture();
  const client = new CodexClient(f.home, { spawn: f.spawn });
  try {
    assert.deepEqual(await client.readAccount(), { connected: true, type: 'chatgpt', planType: 'plus' });
    assert.equal((await client.listModels())[0].id, 'model-from-catalog');
    assert.deepEqual(await client.readRateLimits(), { rateLimits: { primary: { usedPercent: 42 } } });
    assert(f.launches[0].includes('features.plugins=false'));
    assert(f.launches[0].includes('features.hooks=false'));
    assert(f.launches[0].includes('features.apps=false'));
    assert(!f.child.sent.some((message) => String(message.method).startsWith('account/login')));
  } finally {
    client.dispose();
  }
});

test('pet thread disables inherited MCP names without copying their values and requires explicit isolation', async () => {
  const f = fixture();
  const client = new CodexClient(f.home, { spawn: f.spawn });
  try {
    await client.startChat('model-from-catalog', 'Pet persona.');
    const request = f.child.sent.find((message) => message.method === 'thread/start')!;
    const params = request.params as Record<string, unknown>;
    const config = params.config as Record<string, unknown>;
    assert.equal(config['mcp_servers.private_connector.enabled'], false);
    assert.equal(params.permissions, 'dsh-pet-chat');
    assert.equal(params.ephemeral, true);
    assert.equal(params.approvalPolicy, 'never');
    assert(!JSON.stringify(params).includes('never-copy-this'));
    const profile = config['permissions.dsh-pet-chat'] as {
      filesystem: Record<string, unknown>;
      network: Record<string, unknown>;
    };
    assert.equal(profile.filesystem[':root'], 'deny');
    assert.equal(profile.network.enabled, false);
  } finally {
    client.dispose();
  }
});

test('failed profile negotiation stops before any model turn', async () => {
  const f = fixture({ wrongProfile: true });
  const client = new CodexClient(f.home, { spawn: f.spawn });
  await assert.rejects(client.startChat('model-from-catalog', 'Pet persona.'), /只读隔离/);
  assert.equal(f.child.killed, true);
  assert(!f.child.sent.some((message) => message.method === 'turn/start'));
  client.dispose();
});

test('interactive tool approval is declined and ambiguous MCP names fail closed', async () => {
  const f = fixture({ mcpName: 'ambiguous.name' });
  const client = new CodexClient(f.home, { spawn: f.spawn });
  try {
    await client.readAccount();
    f.child.incoming({ id: 'approval1', method: 'item/commandExecution/requestApproval', params: {} });
    assert.deepEqual(f.child.sent.find((message) => message.id === 'approval1')?.result, { decision: 'decline' });
    await assert.rejects(client.startChat('model-from-catalog', 'Pet persona.'), /MCP 名称/);
    assert(!f.child.sent.some((message) => message.method === 'thread/start'));
  } finally {
    client.dispose();
  }
});

test('RPC timeout rejects promptly and disposes child', async () => {
  const f = fixture({ hangAccount: true });
  const client = new CodexClient(f.home, { spawn: f.spawn, requestTimeoutMs: 20 });
  try {
    await assert.rejects(client.readAccount(), /超时/);
  } finally {
    client.dispose();
  }
  assert(f.child.killed);
});

test('service streams an actual turn, defaults auto chatter off, persists only pet preferences', async () => {
  const f = fixture({ chat: true });
  const ai = createCodexAi(f.home, f.logger, { spawn: f.spawn });
  try {
    await ai.refresh();
    assert(ai.isReady());
    assert(!ai.canWhisper());
    let output = '';
    for await (const part of ai.stream({
      provider: 'codex',
      model: ai.currentSelection().model,
      messages: [{ role: 'user', content: '你好' }],
    }))
      output += part.text;
    assert.equal(output, '你好，我在这里。');
    assert(f.child.sent.some((message) => message.method === 'thread/unsubscribe'));
    await ai.saveSettings({ automaticWhispers: true, whisperIntervalSec: 600 });
    assert(ai.canWhisper());
    const saved = JSON.parse(readFileSync(join(f.home, 'dsh-pet/codex-settings.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), [
      'automaticWhispers',
      'enabled',
      'model',
      'timeoutMs',
      'whisperIntervalSec',
    ]);
    await assert.rejects(ai.saveSettings({ apiKey: 'must-not-save' }), /设置无效/);
  } finally {
    ai.dispose();
  }
});

test('chat cancellation releases the busy state and kills only the adapter child', async () => {
  const f = fixture();
  const ai = createCodexAi(f.home, f.logger, { spawn: f.spawn });
  const controller = new AbortController();
  try {
    await ai.refresh();
    const stream = ai.stream({
      provider: 'codex',
      model: ai.currentSelection().model,
      messages: [{ role: 'user', content: '你好' }],
      signal: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    const rejection = assert.rejects(next, /取消/);
    await f.started;
    const second = ai.stream({
      provider: 'codex',
      model: ai.currentSelection().model,
      messages: [{ role: 'user', content: '第二条' }],
    });
    await assert.rejects(second[Symbol.asyncIterator]().next(), /正在回复/);
    controller.abort();
    await rejection;
    assert(f.child.killed);
  } finally {
    ai.dispose();
  }
});

test('missing quota stays unavailable and valid percentages are clamped', () => {
  assert.equal(remainingPercent(undefined), null);
  assert.equal(remainingPercent(null), null);
  assert.equal(remainingPercent(Number.NaN), null);
  assert.equal(remainingPercent(25), 75);
  assert.equal(remainingPercent(-10), 100);
  assert.equal(remainingPercent(110), 0);
});
