import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { createCodexAi } from './index.ts';
import type { SpawnCodex } from './client.ts';

type Message = Record<string, unknown>;
class ModelChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  sent: Message[] = [];
  stdin: Writable;
  catalog = [
    { model: 'default-model', displayName: 'Default Model', isDefault: true },
    { model: 'chosen-model', displayName: 'Chosen Model', isDefault: false },
  ];
  holdCatalog = false;
  held: Message[] = [];
  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const request = JSON.parse(String(chunk)) as Message;
        this.sent.push(request);
        queueMicrotask(() => this.handle(request));
        callback();
      },
    });
  }
  incoming(value: Message): void {
    this.stdout.write(JSON.stringify(value) + '\n');
  }
  reply(request: Message, result: unknown): void {
    this.incoming({ id: request.id, result });
  }
  handle(request: Message): void {
    switch (request.method) {
      case 'initialize':
        this.reply(request, {});
        break;
      case 'account/read':
        this.reply(request, { account: { type: 'chatgpt', planType: 'plus' } });
        break;
      case 'model/list':
        if (this.holdCatalog) this.held.push(request);
        else this.reply(request, { data: this.catalog, nextCursor: null });
        break;
      case 'config/read':
        this.reply(request, { config: {} });
        break;
      case 'thread/start':
        this.reply(request, {
          thread: { id: 'model-test-thread' },
          activePermissionProfile: { id: 'dsh-pet-chat' },
          sandbox: { type: 'readOnly', networkAccess: false },
          approvalPolicy: 'never',
        });
        break;
      case 'turn/start':
        this.reply(request, { turn: { id: 'model-test-turn' } });
        queueMicrotask(() => {
          this.incoming({
            method: 'item/agentMessage/delta',
            params: { threadId: 'model-test-thread', delta: 'selected reply' },
          });
          this.incoming({
            method: 'turn/completed',
            params: { threadId: 'model-test-thread', turn: { id: 'model-test-turn', status: 'completed' } },
          });
        });
        break;
      case 'thread/unsubscribe':
      case 'turn/interrupt':
        this.reply(request, {});
        break;
    }
  }
  releaseCatalog(): void {
    this.holdCatalog = false;
    for (const request of this.held.splice(0)) this.reply(request, { data: this.catalog, nextCursor: null });
  }
  kill(): boolean {
    this.emit('close', 0);
    return true;
  }
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-codex-models-'));
  const child = new ModelChild();
  const spawn: SpawnCodex = () => child as unknown as ChildProcessWithoutNullStreams;
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const service = createCodexAi(home, logger, { spawn });
  return {
    home,
    child,
    service,
    close() {
      service.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
const input = (model?: string) => ({
  provider: 'codex',
  ...(model ? { model } : {}),
  messages: [{ role: 'user', content: 'hello' }],
});
async function consume(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test('following the default remains an empty saved preference while refreshed effective models can change', async () => {
  const f = fixture();
  try {
    const first = await f.service.readModels();
    assert.equal(first.configuredModel, '');
    assert.equal(first.effectiveModel, 'default-model');
    assert.equal(f.service.getSettings().model, '');
    await f.service.saveSettings({ model: '' });
    assert.equal(JSON.parse(readFileSync(join(f.home, 'dsh-pet/codex-settings.json'), 'utf8')).model, '');
    f.child.catalog = f.child.catalog.map((item) => ({ ...item, isDefault: item.model === 'chosen-model' }));
    const second = await f.service.readModels();
    assert.equal(second.configuredModel, '');
    assert.equal(second.effectiveModel, 'chosen-model');
    assert.equal(f.service.currentSelection().model, 'chosen-model');
  } finally {
    f.close();
  }
});

test('saving a nondefault model persists it and the next reply starts that exact model', async () => {
  const f = fixture();
  try {
    await f.service.refresh();
    await f.service.saveSettings({ model: 'chosen-model' });
    assert.equal(f.service.getSettings().model, 'chosen-model');
    assert.equal(JSON.parse(readFileSync(join(f.home, 'dsh-pet/codex-settings.json'), 'utf8')).model, 'chosen-model');
    assert.deepEqual(await consume(f.service.stream(input(f.service.currentSelection().model))), [
      { type: 'text', text: 'selected reply' },
    ]);
    const start = f.child.sent.find((request) => request.method === 'thread/start')!;
    assert.equal((start.params as Message).model, 'chosen-model');
  } finally {
    f.close();
  }
});

test('removed or unknown models fail explicitly without replacing the configured model or starting another', async () => {
  const f = fixture();
  try {
    await f.service.saveSettings({ model: 'chosen-model' });
    const saved = readFileSync(join(f.home, 'dsh-pet/codex-settings.json'), 'utf8');
    await assert.rejects(f.service.saveSettings({ model: 'unknown-model' }), /不在当前 Codex 可用清单/);
    assert.equal(readFileSync(join(f.home, 'dsh-pet/codex-settings.json'), 'utf8'), saved);
    f.child.catalog = f.child.catalog.filter((item) => item.model !== 'chosen-model');
    const catalog = await f.service.readModels();
    assert.equal(catalog.configuredModel, 'chosen-model');
    assert.equal(catalog.effectiveModel, '');
    assert.equal(f.service.isReady(), false);
    const check = await f.service.testConnection({});
    assert.equal(check.ok, false);
    assert.match(check.message, /模型不可用/);
    await assert.rejects(consume(f.service.stream(input('chosen-model'))));
    assert.equal(
      f.child.sent.some((request) => request.method === 'thread/start'),
      false,
    );
  } finally {
    f.close();
  }
});

test('a pending model save blocks competing saves and chat until the refreshed selection is committed', async () => {
  const f = fixture();
  try {
    await f.service.refresh();
    f.child.holdCatalog = true;
    const saving = f.service.saveSettings({ model: 'chosen-model' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.child.held.length, 1);
    await assert.rejects(f.service.saveSettings({ model: 'default-model' }), /保存完成/);
    await assert.rejects(consume(f.service.stream(input())), /保存设置/);
    assert.equal(
      f.child.sent.some((request) => request.method === 'thread/start'),
      false,
    );
    f.child.releaseCatalog();
    await saving;
    assert.equal(f.service.currentSelection().model, 'chosen-model');
    assert.equal(f.service.isReady(), true);
  } finally {
    f.close();
  }
});
