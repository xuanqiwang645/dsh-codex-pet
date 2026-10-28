import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';

const ipcFile = fileURLToPath(new URL('../../runtime/electron-helper/main/ipc.js', import.meta.url));
const ipcSource = readFileSync(ipcFile, 'utf8');
const realRequire = createRequire(ipcFile);
const userApp = '/Users/pet-test/Applications/Codex.app';
const sender = {};
const event = { sender };
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Execute the actual IPC module against inert Electron/filesystem adapters. No GUI or files change. */
function harness({ openTarget = 'codex', installed = [], openError = '', rejected = false, siteUrl = '' } = {}) {
  const listeners = new Map();
  const paths = [];
  const external = [];
  const errors = [];
  const electron = {
    BrowserWindow: { fromWebContents: (value) => value === sender ? { isDestroyed: () => false } : null },
    screen: {}, desktopCapturer: {},
    dialog: { showErrorBox: (...args) => errors.push(args) },
  };
  const fakeRequire = (name) => {
    if (name === 'electron') return electron;
    if (name === 'node:fs') return { existsSync: (path) => installed.includes(path) };
    if (name === 'node:os') return { homedir: () => '/Users/pet-test' };
    return realRequire(name);
  };
  const exported = { exports: {} };
  const wrapper = vm.runInNewContext(`(function(require,module,exports){${ipcSource}\n})`, {
    URL, process: { env: { DSH_PET_SITE_URL: siteUrl } }, console: { error() {} },
  }, { filename: ipcFile });
  wrapper(fakeRequire, exported, exported.exports);
  exported.exports.registerIpc({
    ipcMain: { on: (name, listener) => listeners.set(name, listener), handle() {} },
    petWindows: {}, openTarget, petRoute: '/dsh-pet-7340',
    shell: {
      openPath: async (path) => { paths.push(path); if (rejected) throw new Error('launch failed'); return openError; },
      openExternal: async (url) => { external.push(url); },
    },
  });
  return { listeners, paths, external, errors };
}

test('Codex opener finds a user-local installation and ignores renderer-supplied URLs', async () => {
  const h = harness({ installed: [userApp] });
  h.listeners.get('pet:open-site')(event, { url: 'https://untrusted.example/' });
  await settle();
  assert.deepEqual(h.paths, [userApp]);
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
});

test('Codex opener keeps system installation precedence', async () => {
  const h = harness({ installed: ['/Applications/ChatGPT.app', userApp] });
  h.listeners.get('pet:open-site')(event);
  await settle();
  assert.deepEqual(h.paths, ['/Applications/ChatGPT.app']);
});

test('missing Codex installation gives an actionable error', async () => {
  const h = harness();
  h.listeners.get('pet:open-site')(event);
  await settle();
  assert.deepEqual(h.paths, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0][0], '无法打开 Codex');
});

test('both resolved launch errors and rejected launch promises reach the user', async () => {
  for (const options of [{ openError: 'not an app' }, { rejected: true }]) {
    const h = harness({ installed: [userApp], ...options });
    h.listeners.get('pet:open-site')(event);
    await settle();
    assert.equal(h.errors.length, 1);
  }
});

test('open actions reject senders without a live pet window', async () => {
  const h = harness({ installed: [userApp], siteUrl: 'http://127.0.0.1:4567/standalone-ai/#token=test-only' });
  h.listeners.get('pet:open-site')({ sender: {} });
  h.listeners.get('pet:open-settings')({ sender: {} });
  await settle();
  assert.deepEqual(h.paths, []);
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
});

test('settings opener uses only the fixed authenticated loopback URL', async () => {
  const siteUrl = 'http://127.0.0.1:4567/standalone-ai/#token=test-only';
  const h = harness({ siteUrl });
  h.listeners.get('pet:open-settings')(event, { url: 'https://untrusted.example/' });
  await settle();
  assert.deepEqual(h.external, [siteUrl]);
  for (const invalid of ['https://outside.example/#token=test-only', 'file:///tmp/settings', 'http://localhost:4567/']) {
    const rejected = harness({ siteUrl: invalid });
    rejected.listeners.get('pet:open-settings')(event);
    await settle();
    assert.deepEqual(rejected.external, []);
  }
});

test('original desktop, standalone, and web open paths remain available', async () => {
  const desktop = harness({ openTarget: 'desktop' });
  desktop.listeners.get('pet:open-site')(event, { url: 'http://127.0.0.1:3080/' });
  await settle();
  assert.deepEqual(desktop.external, ['dsh://open']);
  const authed = 'http://127.0.0.1:3080/standalone-ai/#token=test-only';
  const standalone = harness({ openTarget: 'standalone', siteUrl: authed });
  standalone.listeners.get('pet:open-site')(event, { url: 'http://127.0.0.1:3080/' });
  await settle();
  assert.deepEqual(standalone.external, [authed]);
  const web = harness({ openTarget: 'web' });
  web.listeners.get('pet:open-site')(event, { url: 'http://127.0.0.1:3080/' });
  await settle();
  assert.deepEqual(web.external, ['http://127.0.0.1:3080/']);
});
