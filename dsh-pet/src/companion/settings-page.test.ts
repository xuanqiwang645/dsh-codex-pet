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
  assert.match(codexSettingsPage, /DSH · Codex 桌宠设置/);
  assert.match(codexSettingsPage, /桌面宠物 \/ CODEX COMPANION/);
  assert.match(codexSettingsPage, /右键宠物可打开/);
  assert.doesNotMatch(codexSettingsPage, /鲸鱼娘/);
  assert.match(codexSettingsScript, /textContent/);
  assert.ok(!codexSettingsScript.includes('innerHTML'));
  assert.match(codexSettingsPage, /min="300"/);
  assert.match(codexSettingsPage, /<select id="model"/);
  assert.ok(!codexSettingsPage.includes('<input id="model"'));
  assert.match(codexSettingsPage, /刷新模型列表/);
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
  children: PageElement[];
  listeners: Record<string, (event: { preventDefault(): void }) => Promise<void> | void>;
  addEventListener(name: string, listener: PageElement['listeners'][string]): void;
  append(...values: unknown[]): void;
  replaceChildren(): void;
}

async function runPage(
  fetcher: (path: string, options: { method: string; body?: string }) => unknown,
  statusFor: (path: string, options: { method: string; body?: string }) => number = () => 200,
) {
  const elements = new Map<string, PageElement>();
  const makeElement = (): PageElement => ({
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    className: '',
    dataset: {},
    children: [],
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    append(...values) {
      this.children.push(...(values as PageElement[]));
    },
    replaceChildren() {
      this.children = [];
    },
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
    fetch: async (path: string, options: { method: string; body?: string }) => {
      const value = await fetcher(path, options);
      const status = statusFor(path, options);
      return { ok: status >= 200 && status < 300, status, json: async () => value };
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return get;
}

const modelCatalog = (configuredModel = '') => ({
  ok: true,
  connected: true,
  configuredModel,
  effectiveModel: configuredModel || 'catalog-default',
  models: [
    { id: 'catalog-default', name: 'Default model', isDefault: true },
    { id: 'catalog-alternate', name: 'Alternate model', isDefault: false },
  ],
});
const settings = { enabled: true, model: 'catalog-default', automaticWhispers: false, whisperIntervalSec: 300 };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const event = { preventDefault() {} };

test('settings submits explicit auto-whisper choice and rejects intervals below 300 seconds', async () => {
  const writes: Record<string, unknown>[] = [];
  const get = await runPage((path, options) => {
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/companion/models') return modelCatalog();
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

test('settings errors show safe string messages from both JSON response shapes', async () => {
  for (const [payload, expected] of [
    [{ error: '请等待当前对话完成后再修改设置。' }, '请等待当前对话完成后再修改设置。'],
    [{ message: '此模型不在当前 Codex 可用清单中。' }, '此模型不在当前 Codex 可用清单中。'],
    [{ error: { raw: 'not a public message' } }, '本机服务暂时无法完成请求。'],
  ] as const) {
    const get = await runPage(
      (path, options) => {
        if (path === '/companion/models') return modelCatalog();
        if (path === '/companion/quota') return { ok: true, buckets: [] };
        if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
        return options.method === 'POST' ? payload : settings;
      },
      (_path, options) => (options.method === 'POST' ? 400 : 200),
    );
    await get('settings').listeners.submit(event);
    assert.equal(get('status').textContent, expected);
    assert.equal(get('status').dataset.error, 'true');
  }
});

test('appearance save re-reads current pets and preserves every unrelated pet field', async () => {
  let reads = 0;
  let written: { pets: Array<Record<string, unknown>> } | undefined;
  const oldPet = {
    id: 'main',
    name: '鲸鱼娘',
    size: 462,
    display: 'desktop',
    fixedEnabled: false,
    position: { corner: 'top-right', marginX: 10, marginY: 20 },
  };
  const currentOther = { id: 'other', name: '刚改过名字', size: 300, fixedEnabled: false, display: 'desktop' };
  const get = await runPage((path, options) => {
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/companion/models') return modelCatalog();
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

test('character picker includes every entry and initially selects the currently displayed character', async () => {
  const main = { id: 'main', name: '鲸鱼娘', size: 420, display: 'none' };
  const dragon = { id: 'chatgpt-dragon', name: 'ChatGPT 白龙娘', size: 380, display: 'desktop', fixedEnabled: true };
  const get = await runPage((path) => {
    if (path === '/companion/models') return modelCatalog();
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [main] }, 'chatgpt-dragon': { pets: [dragon] } };
    return settings;
  });
  assert.deepEqual(
    get('pet-select').children.map((item) => item.value),
    ['main', 'chatgpt-dragon'],
  );
  assert.equal(get('pet-select').value, 'chatgpt-dragon');
  assert.equal(get('pet-size').value, '380');
  assert.equal(get('pet-fixed').checked, true);
  assert.match(get('pet-current').textContent, /当前显示：ChatGPT 白龙娘/);
  assert.equal(get('pet-apply').disabled, true, 'the sole current character needs no redundant restart');
  get('pet-select').value = 'main';
  await get('pet-select').listeners.change(event);
  assert.equal(get('pet-size').value, '420');
  assert.equal(get('pet-apply').disabled, false);
});

test('pack appearance writes only its entry with a fresh full pet list and leaves main unchanged', async () => {
  let reads = 0;
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const main = { id: 'main', name: '鲸鱼娘', size: 420, display: 'desktop' };
  const dragon = {
    id: 'chatgpt-dragon',
    name: 'ChatGPT 白龙娘',
    size: 380,
    display: 'none',
    fixedEnabled: false,
    position: { corner: 'bottom-left', marginX: 20, marginY: 30 },
    balanceEnabled: true,
  };
  const sibling = { id: 'dragon-friend', name: '另一只龙', size: 300, display: 'none', fixedEnabled: false };
  const get = await runPage((path, options) => {
    if (path === '/companion/models') return modelCatalog();
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') {
      assert.equal(options.method, 'GET', 'pack changes must not PUT the main entry');
      reads++;
      return {
        main: { pets: [main] },
        'chatgpt-dragon': { pets: [dragon, { ...sibling, name: reads > 1 ? '刚修改的名字' : sibling.name }] },
      };
    }
    if (path === '/dsh-pet-7340/pet-config') {
      const body = JSON.parse(options.body!);
      writes.push({ path, method: options.method, body });
      return { main: { pets: [main] }, 'chatgpt-dragon': { pets: body.pets } };
    }
    return settings;
  });
  get('pet-select').value = 'chatgpt-dragon';
  await get('pet-select').listeners.change(event);
  get('pet-size').value = '500';
  get('pet-fixed').checked = true;
  await get('pet-settings').listeners.submit(event);
  assert.equal(reads, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.equal(writes[0].body.entry, 'chatgpt-dragon');
  const pets = writes[0].body.pets as Array<Record<string, unknown>>;
  assert.equal(pets[0].size, 500);
  assert.equal(pets[0].fixedEnabled, true);
  assert.equal(pets[0].display, 'none', 'appearance save must not switch visibility');
  assert.deepEqual(pets[0].position, dragon.position);
  assert.equal(pets[1].name, '刚修改的名字');
  assert.equal(main.size, 420);
  assert.equal(get('pet-select').value, 'chatgpt-dragon', 'editing selection survives the refreshed config');
});

test('applying a character sends one selection request and disables stale settings after restart', async () => {
  const writes: Array<{ path: string; body: unknown }> = [];
  const get = await runPage((path, options) => {
    if (path === '/companion/models') return modelCatalog();
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config')
      return {
        main: { pets: [{ id: 'main', name: '鲸鱼娘', size: 420, display: 'desktop' }] },
        'chatgpt-dragon': { pets: [{ id: 'chatgpt-dragon', name: 'ChatGPT 白龙娘', size: 420, display: 'none' }] },
      };
    if (options.method === 'POST') {
      writes.push({ path, body: JSON.parse(options.body!) });
      return { ok: true, selectedId: 'chatgpt-dragon' };
    }
    return settings;
  });
  get('pet-select').value = 'chatgpt-dragon';
  await get('pet-select').listeners.change(event);
  assert.equal(writes.length, 0, 'choosing an option must not silently switch pets');
  await get('pet-apply').listeners.click(event);
  assert.deepEqual(writes, [{ path: '/companion/pets/select', body: { id: 'chatgpt-dragon' } }]);
  assert.match(get('pet-status').textContent, /已切换为ChatGPT 白龙娘.*正在重新启动.*重新打开设置/);
  for (const id of [
    'pet-select',
    'pet-apply',
    'pet-save',
    'pet-size',
    'pet-fixed',
    'save',
    'model',
    'check',
    'enabled',
  ])
    assert.equal(get(id).disabled, true, id);
  await get('pet-apply').listeners.click(event);
  await get('pet-settings').listeners.submit(event);
  await get('settings').listeners.submit(event);
  assert.equal(writes.length, 1, 'stale credentials must not be reused after the restart');
});

test('character selection failure remains visible and can be retried', async () => {
  let attempts = 0;
  const get = await runPage((path) => {
    if (path === '/companion/models') return modelCatalog();
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config')
      return {
        main: { pets: [{ id: 'main', name: '鲸鱼娘', size: 420, display: 'desktop' }] },
        'chatgpt-dragon': { pets: [{ id: 'chatgpt-dragon', name: 'ChatGPT 白龙娘', size: 420, display: 'none' }] },
      };
    if (path === '/companion/pets/select') {
      attempts++;
      return attempts === 1
        ? { ok: false, message: '暂时不能切换，请重试。' }
        : { ok: true, selectedId: 'chatgpt-dragon' };
    }
    return settings;
  });
  get('pet-select').value = 'chatgpt-dragon';
  await get('pet-select').listeners.change(event);
  await get('pet-apply').listeners.click(event);
  assert.match(get('pet-status').textContent, /切换失败.*请重试/);
  assert.equal(get('pet-apply').disabled, false);
  assert.equal(get('pet-select').value, 'chatgpt-dragon');
  await get('pet-apply').listeners.click(event);
  assert.equal(attempts, 2);
  assert.match(get('pet-status').textContent, /已切换/);
});

test('model picker lists discovered models, saves a nondefault choice, and can return to follow-default', async () => {
  let selected = '';
  const writes: Record<string, unknown>[] = [];
  const get = await runPage((path, options) => {
    if (path === '/companion/models') return modelCatalog(selected);
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
    if (options.method === 'POST') {
      const body = JSON.parse(options.body!);
      writes.push(body);
      selected = body.model;
      return { ...settings, model: selected };
    }
    return settings;
  });
  assert.equal(get('model').value, '', 'effective default from settings must not pin a model');
  assert.deepEqual(
    get('model').children.map((item) => item.value),
    ['', 'catalog-default', 'catalog-alternate'],
  );
  assert.equal(get('save').disabled, false);
  get('model').value = 'catalog-alternate';
  await get('model').listeners.change(event);
  assert.match(get('model-status').textContent, /尚未保存/);
  await get('settings').listeners.submit(event);
  assert.equal(writes[0].model, 'catalog-alternate');
  assert.equal(get('model').value, 'catalog-alternate');
  assert.match(get('model-current').textContent, /Alternate model.*catalog-alternate/);
  assert.match(get('status').textContent, /下一次对话/);
  get('model').value = '';
  await get('model').listeners.change(event);
  await get('settings').listeners.submit(event);
  assert.equal(writes[1].model, '');
  assert.match(get('model-current').textContent, /Default model/);
});

test('model-list failure blocks saving and a retry restores the existing model without clearing it', async () => {
  let reads = 0,
    writes = 0;
  const get = await runPage((path, options) => {
    if (path === '/companion/models') {
      if (++reads === 1) throw new Error('temporary catalog failure');
      return modelCatalog('catalog-alternate');
    }
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
    if (options.method === 'POST') writes++;
    return settings;
  });
  assert.equal(get('save').disabled, true);
  assert.equal(get('model').disabled, true);
  assert.match(get('model-status').textContent, /读取失败.*刷新模型列表/);
  await get('settings').listeners.submit(event);
  assert.equal(writes, 0);
  await get('refresh-models').listeners.click(event);
  assert.equal(get('model').value, 'catalog-alternate');
  assert.equal(get('save').disabled, false);
});

test('unavailable saved models remain visible until the user explicitly chooses a replacement', async () => {
  const writes: Record<string, unknown>[] = [];
  const get = await runPage((path, options) => {
    if (path === '/companion/models') return { ...modelCatalog('retired-model'), effectiveModel: '' };
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
    if (options.method === 'POST') writes.push(JSON.parse(options.body!));
    return settings;
  });
  assert.equal(get('model').value, 'retired-model');
  assert.equal(get('model').children[get('model').children.length - 1]?.disabled, true);
  assert.match(get('model-status').textContent, /已保存模型目前不可用/);
  assert.equal(get('save').disabled, true);
  await get('settings').listeners.submit(event);
  assert.equal(writes.length, 0);
  get('model').value = 'catalog-alternate';
  await get('model').listeners.change(event);
  assert.equal(get('save').disabled, false);
  await get('settings').listeners.submit(event);
  assert.equal(writes[0].model, 'catalog-alternate');
});

test('late settings reads and catalog refreshes preserve an unsaved explicit model choice', async () => {
  let finishSettings: (value: typeof settings) => void = () => {};
  const pendingSettings = new Promise<typeof settings>((resolve) => {
    finishSettings = resolve;
  });
  const get = await runPage((path) => {
    if (path === '/companion/models') return modelCatalog();
    if (path === '/companion/quota') return { ok: true, buckets: [] };
    if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
    return pendingSettings;
  });
  assert.equal(get('save').disabled, true);
  get('model').value = 'catalog-alternate';
  await get('model').listeners.change(event);
  finishSettings(settings);
  await flush();
  assert.equal(get('model').value, 'catalog-alternate');
  assert.equal(get('save').disabled, false);
  await get('refresh-models').listeners.click(event);
  assert.equal(get('model').value, 'catalog-alternate');
  assert.match(get('model-status').textContent, /尚未保存/);
});

test('disconnected accounts and empty catalogs explain why selection is unavailable', async () => {
  for (const connected of [true, false]) {
    const get = await runPage((path) => {
      if (path === '/companion/models')
        return { ok: true, connected, models: [], configuredModel: 'kept-model', effectiveModel: '' };
      if (path === '/companion/quota') return { ok: true, buckets: [] };
      if (path === '/dsh-pet-7340/config') return { main: { pets: [] } };
      return settings;
    });
    assert.equal(get('model').value, 'kept-model');
    assert.equal(get('save').disabled, true);
    assert.match(get('model-status').textContent, connected ? /暂未提供/ : /尚未连接/);
  }
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
    assert.match(await page.text(), /DSH · Codex 桌宠设置/);
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
