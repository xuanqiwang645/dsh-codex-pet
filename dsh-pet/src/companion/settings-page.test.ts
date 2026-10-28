import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { startRouter } from '../app/router.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { createCodexQuotaRoute } from './balance.ts';
import { codexSettingsAssets, codexSettingsPage, codexSettingsScript } from './settings-page.ts';

test('Codex settings has no credential or endpoint inputs and renders dynamic values with textContent', () => {
  assert.ok(!codexSettingsPage.includes('id="apiKey"'));
  assert.ok(!codexSettingsPage.includes('id="baseUrl"'));
  assert.match(codexSettingsPage, /沿用本机 Codex 登录/);
  assert.match(codexSettingsScript, /textContent/);
  assert.ok(!codexSettingsScript.includes('innerHTML'));
  assert.match(codexSettingsPage, /min="300"/);
  assert.match(codexSettingsPage, /消耗套餐额度/);
  assert.match(codexSettingsPage, /关闭后仍可右键手动碎碎念/);
});

interface PageElement {
  value: string;
  checked: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  listeners: Record<string, (event: { preventDefault(): void }) => Promise<void> | void>;
  addEventListener(name: string, listener: PageElement['listeners'][string]): void;
  append(...values: unknown[]): void;
  replaceChildren(): void;
}

async function runPage(fetcher: (path: string, options: { method: string; body?: string }) => unknown) {
  const elements = new Map<string, PageElement>();
  const makeElement = (): PageElement => ({
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    className: '',
    dataset: {},
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    append() {},
    replaceChildren() {},
  });
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id)!;
  };
  runInNewContext(codexSettingsScript, {
    URLSearchParams,
    Intl,
    history: { replaceState() {} },
    location: { hash: '#token=local-test-token', pathname: '/standalone-ai/' },
    document: { getElementById: get, createElement: makeElement },
    fetch: async (path: string, options: { method: string; body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => fetcher(path, options),
    }),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return get;
}

test('settings submits explicit auto-whisper choice and rejects intervals below 300 seconds', async () => {
  const writes: Record<string, unknown>[] = [];
  const get = await runPage((path, options) => {
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
    if (options.method === 'POST') {
      writes.push(JSON.parse(options.body!));
      return {};
    }
    return { enabled: true, model: '', automaticWhispers: false, whisperIntervalSec: 300 };
  });
  assert.equal(get('automaticWhispers').checked, false);
  get('automaticWhispers').checked = true;
  get('whisperIntervalSec').value = '600';
  await get('settings').listeners.submit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].automaticWhispers, true);
  assert.equal(writes[0].whisperIntervalSec, 600);
  get('whisperIntervalSec').value = '299';
  await get('settings').listeners.submit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.match(get('status').textContent, /300–86400/);
});

test('appearance save re-reads current pets and preserves every unrelated pet field', async () => {
  let reads = 0;
  let written: { pets: Array<Record<string, unknown>> } | undefined;
  const oldPet = {
    id: 'main',
    name: '鲸鱼娘',
    size: 462,
    fixedEnabled: false,
    position: { corner: 'top-right', marginX: 10, marginY: 20 },
  };
  const currentOther = { id: 'other', name: '刚改过名字', size: 300, fixedEnabled: false, display: 'desktop' };
  const get = await runPage((path, options) => {
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config' && options.method === 'PUT') {
      written = JSON.parse(options.body!);
      return { main: written };
    }
    if (path === '/dsh-pet-7340/config') {
      reads++;
      return { main: { pets: [oldPet, reads > 1 ? currentOther : { ...currentOther, name: '旧名字' }] } };
    }
    return { enabled: true, model: '', automaticWhispers: false, whisperIntervalSec: 300 };
  });
  get('pet-size').value = '520';
  get('pet-fixed').checked = true;
  await get('pet-settings').listeners.submit({ preventDefault() {} });
  assert.equal(reads, 2);
  assert.equal(written?.pets[0].size, 520);
  assert.equal(written?.pets[0].fixedEnabled, true);
  assert.deepEqual(written?.pets[0].position, oldPet.position);
  assert.deepEqual(written?.pets[1], currentOther);
  assert.match(get('pet-status').textContent, /重启桌宠后生效/);
});

test('custom settings assets and quota use the existing authenticated request boundary', async () => {
  let calls = 0;
  const security = createRequestSecurity();
  const server = await startRouter(
    [
      createCodexQuotaRoute(async () => {
        calls++;
        return { rateLimits: { limitId: 'codex', primary: { usedPercent: 37, windowDurationMins: 300 } } };
      }),
    ],
    {
      security,
      log: () => {},
      status: () => ({}),
      landingPage: () => '',
      settingsAssets: codexSettingsAssets,
    },
  );
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { 'X-DSH-Pet-Token': security.token };
  try {
    const unauthorized = await fetch(base + '/companion/quota');
    assert.equal(unauthorized.status, 403);
    await unauthorized.text();
    assert.equal(calls, 0);
    const page = await fetch(base + '/standalone-ai/', { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /鲸鱼娘 · 桌宠设置/);
    const script = await fetch(base + '/standalone-ai/settings.js', { headers });
    assert.match(await script.text(), /companion\/quota/);
    const quota = await fetch(base + '/companion/quota', { headers });
    assert.equal(quota.status, 200);
    const result = (await quota.json()) as {
      ok: boolean;
      buckets: Array<{ windows: Array<{ remainingPercent: number }> }>;
    };
    assert.equal(result.ok, true);
    assert.equal(result.buckets[0].windows[0].remainingPercent, 63);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test('quota HTTP failures do not expose raw child-process errors', async () => {
  const security = createRequestSecurity();
  const server = await startRouter(
    [
      createCodexQuotaRoute(async () => {
        throw new Error('secret raw error marker');
      }),
    ],
    {
      security,
      log: () => {},
      status: () => ({}),
      landingPage: () => '',
    },
  );
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/companion/quota`, {
      headers: { 'X-DSH-Pet-Token': security.token },
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes('secret raw error marker'));
    assert.match(body, /确认登录/);
  } finally {
    await server.close();
  }
});
