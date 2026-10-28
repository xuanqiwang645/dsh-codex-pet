import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startRouter } from '../app/router.ts';
import { readAllConfig } from '../host/config.ts';
import { runConfigOperation } from '../host/config/queue.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { createCompanionPetsRoute } from './pets.ts';

const pet = (id: string, display: string) => ({
  id,
  name: id,
  size: 420,
  balanceEnabled: true,
  whisperEnabled: false,
  fixedEnabled: true,
  display,
  position: { corner: 'bottom-right', marginX: 40, marginY: 65 },
});
const defaultFile = fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url));
async function harness(options: { failCommit?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-selection-'));
  const petDir = join(root, 'pet');
  mkdirSync(petDir);
  const mainFile = join(root, 'main-config.jsonc');
  const packFile = join(petDir, 'chatgpt-dragon-config.jsonc');
  const main =
    '// keep exact original bytes on failure\n' +
    JSON.stringify({
      pets: [{ ...pet('main', 'desktop'), customLabel: 'keep me' }, pet('side', 'desktop')],
      whisperPrompt: 'original persona',
      customMain: { preserve: true },
    });
  const pack = JSON.stringify({
    pets: [pet('chatgpt-dragon', 'none')],
    whisperPrompt: 'dragon persona',
    customPack: 42,
  });
  const memoryFile = join(root, 'memory.json');
  writeFileSync(mainFile, main);
  writeFileSync(packFile, pack);
  writeFileSync(memoryFile, 'existing chat memory stays exact\n');
  const configPaths = { defaultFile, userFile: mainFile, petDir };
  const security = createRequestSecurity();
  let restarts = 0;
  let failed = false;
  const route = createCompanionPetsRoute({
    configPaths,
    restart: () => {
      restarts++;
    },
    moveFile: (from, to) => {
      if (options.failCommit && !failed && String(to) === packFile && String(from).includes('.pet-select.')) {
        failed = true;
        throw new Error('private filesystem failure ' + packFile);
      }
      renameSync(from, to);
    },
  });
  const server = await startRouter([route], { security, log() {}, status: () => ({}), landingPage: () => '' });
  const url = `http://127.0.0.1:${server.port}/companion/pets/select`;
  const request = async (body: unknown, method = 'POST', authenticated = true) => {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'X-DSH-Pet-Token': security.token } : {}) },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: (await response.json()) as { ok?: boolean; selectedId?: string; message?: string },
    };
  };
  return {
    root,
    mainFile,
    packFile,
    memoryFile,
    main,
    pack,
    configPaths,
    request,
    get restarts() {
      return restarts;
    },
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('role selection uses the existing capability and rejects malformed, missing and unknown ids without writes', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request({ id: 'main' }, 'POST', false)).status, 403);
    assert.equal((await h.request(undefined, 'GET')).status, 405);
    for (const input of ['{broken', {}, { id: '../outside' }, { id: 'main', extra: true }, { id: 'not-installed' }]) {
      assert.equal((await h.request(input)).status, 400);
    }
    assert.equal(readFileSync(h.mainFile, 'utf8'), h.main);
    assert.equal(readFileSync(h.packFile, 'utf8'), h.pack);
    assert.equal(h.restarts, 0);
  } finally {
    await h.close();
  }
});

test('selecting either role leaves exactly one visible pet, preserves metadata and memory, and restarts once', async () => {
  const h = await harness();
  try {
    const selected = await h.request({ id: 'chatgpt-dragon' });
    assert.equal(selected.status, 200);
    assert.deepEqual(
      { ok: selected.body.ok, selectedId: selected.body.selectedId },
      { ok: true, selectedId: 'chatgpt-dragon' },
    );
    const read = () =>
      Object.values(readAllConfig(h.configPaths)).flatMap(
        (conf) => conf.pets as Array<{ id: string; display: string }>,
      );
    assert.deepEqual(
      read()
        .filter((p) => p.display === 'desktop')
        .map((p) => p.id),
      ['chatgpt-dragon'],
    );
    const main = JSON.parse(readFileSync(h.mainFile, 'utf8'));
    const pack = JSON.parse(readFileSync(h.packFile, 'utf8'));
    assert.deepEqual(main.customMain, { preserve: true });
    assert.equal(main.whisperPrompt, 'original persona');
    assert.equal(main.pets[0].customLabel, 'keep me');
    assert.equal(pack.customPack, 42);
    assert.equal(pack.whisperPrompt, 'dragon persona');
    assert.equal(readFileSync(h.memoryFile, 'utf8'), 'existing chat memory stays exact\n');
    assert.equal(h.restarts, 1);
    await h.request({ id: 'chatgpt-dragon' });
    assert.equal(h.restarts, 1, 'already selected role should not restart again');
    await h.request({ id: 'main' });
    assert.deepEqual(
      read()
        .filter((p) => p.display === 'desktop')
        .map((p) => p.id),
      ['main'],
    );
    assert.equal(h.restarts, 2);
  } finally {
    await h.close();
  }
});

test('a later file commit failure rolls back exact original config bytes and never restarts', async () => {
  const h = await harness({ failCommit: true });
  try {
    const result = await h.request({ id: 'chatgpt-dragon' });
    assert.equal(result.status, 500);
    assert.equal(result.body.ok, false);
    assert.doesNotMatch(JSON.stringify(result.body), /private filesystem|dsh-pet-selection-/);
    assert.equal(readFileSync(h.mainFile, 'utf8'), h.main);
    assert.equal(readFileSync(h.packFile, 'utf8'), h.pack);
    assert.equal(h.restarts, 0);
    assert.equal(
      readdirSync(h.root).some((name) => name.includes('pet-select.')),
      false,
    );
    assert.equal(
      readdirSync(join(h.root, 'pet')).some((name) => name.includes('pet-select')),
      false,
    );
  } finally {
    await h.close();
  }
});

test('selection waits for the shared config queue and preserves a concurrent appearance update', async () => {
  const h = await harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const update = runConfigOperation(h.configPaths, async () => {
      await gate;
      const existing = JSON.parse(h.main.slice(h.main.indexOf('\n') + 1));
      existing.pets[0].size = 610;
      writeFileSync(h.mainFile, JSON.stringify(existing));
    });
    let settled = false;
    const selection = h.request({ id: 'chatgpt-dragon' }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    release();
    await update;
    assert.equal((await selection).status, 200);
    assert.equal(JSON.parse(readFileSync(h.mainFile, 'utf8')).pets[0].size, 610);
    assert.equal(h.restarts, 1);
  } finally {
    release();
    await h.close();
  }
});
