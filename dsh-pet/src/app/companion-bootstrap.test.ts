import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureCompanion } from './companion-bootstrap.ts';

test('companion data uses a private application root and preserves previous pet settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-bootstrap-'));
  const values = new Map<string, string>([['appData', root]]);
  const previous = {
    home: process.env.DSH_HOME,
    data: process.env.DSH_CODEX_PET_DATA,
    profile: process.env.DSH_CODEX_PET_PROFILE,
    companion: process.env.DSH_PET_COMPANION,
  };
  const app = {
    getPath: (name: string) => values.get(name)!,
    setPath: (name: string, value: string) => {
      values.set(name, value);
    },
    setName: () => {},
  };
  delete process.env.DSH_CODEX_PET_DATA;
  try {
    configureCompanion(app);
    const data = join(root, 'DSH Codex Pet', 'data');
    assert.equal(process.env.DSH_HOME, data);
    assert.equal(app.getPath('userData'), join(root, 'DSH Codex Pet', 'chromium'));
    assert.equal(app.getPath('sessionData'), app.getPath('userData'));
    assert.equal(existsSync(app.getPath('sessionData')), true);
    const config = join(data, 'dsh-pet', 'main-config.jsonc');
    const parsed = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(parsed.pets[0].display, 'desktop');
    assert.equal(parsed.pets[0].whisperEnabled, true);
    writeFileSync(config, '{"pets":[],"custom":"preserve me"}\n');
    configureCompanion(app);
    assert.equal(readFileSync(config, 'utf8'), '{"pets":[],"custom":"preserve me"}\n');
  } finally {
    for (const [name, value] of Object.entries({
      DSH_HOME: previous.home,
      DSH_CODEX_PET_DATA: previous.data,
      DSH_CODEX_PET_PROFILE: previous.profile,
      DSH_PET_COMPANION: previous.companion,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

function packFixture(root: string) {
  const source = join(root, 'package');
  const pack = join(source, 'assets', 'pet-packs', 'chatgpt-dragon');
  const animation = join(pack, 'chatgpt-dragon-animation');
  mkdirSync(animation, { recursive: true });
  const manifest = {
    id: 'chatgpt-dragon',
    config: 'chatgpt-dragon-config.jsonc',
    animationDirectory: 'chatgpt-dragon-animation',
    version: 1,
  };
  writeFileSync(join(pack, 'pack.json'), JSON.stringify(manifest));
  writeFileSync(
    join(pack, 'chatgpt-dragon-config.jsonc'),
    JSON.stringify({ pets: [{ id: 'chatgpt-dragon', name: 'ChatGPT 白龙娘', display: 'none' }] }),
  );
  writeFileSync(join(animation, '待机.webm'), 'fixture animation');
  const values = new Map<string, string>([['appData', join(root, 'app-data')]]);
  const app = {
    getPath: (name: string) => values.get(name)!,
    setPath: (name: string, value: string) => {
      values.set(name, value);
    },
    setName() {},
  };
  return {
    source,
    pack,
    animation,
    manifest,
    app,
    destination: join(root, 'app-data', 'DSH Codex Pet', 'data', 'dsh-pet', 'pet'),
  };
}

async function isolatedBootstrap(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-pack-bootstrap-'));
  const keys = ['DSH_HOME', 'DSH_CODEX_PET_DATA', 'DSH_CODEX_PET_PROFILE', 'DSH_PET_COMPANION'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  delete process.env.DSH_CODEX_PET_DATA;
  try {
    run(root);
  } finally {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    rmSync(root, { recursive: true, force: true });
  }
}

test('built-in character is installed hidden and later boots preserve custom config and animation bytes', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const config = join(f.destination, 'chatgpt-dragon-config.jsonc');
    const animation = join(f.destination, 'chatgpt-dragon-animation', '待机.webm');
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).pets[0].display, 'none');
    assert.equal(
      JSON.parse(readFileSync(join(f.destination, '..', 'main-config.jsonc'), 'utf8')).pets[0].display,
      'desktop',
    );
    writeFileSync(config, '// user config\n{"pets":[{"id":"chatgpt-dragon","display":"desktop"}],"custom":"keep"}\n');
    writeFileSync(animation, 'user animation');
    writeFileSync(join(f.animation, '挥手.webm'), 'new bundled animation');
    configureCompanion(f.app, f.source);
    assert.match(readFileSync(config, 'utf8'), /user config/);
    assert.equal(readFileSync(animation, 'utf8'), 'user animation');
    assert.equal(
      readFileSync(join(f.destination, 'chatgpt-dragon-animation', '挥手.webm'), 'utf8'),
      'new bundled animation',
    );
  });
});

test('built-in pack refuses unapproved manifest paths and linked source files before installing a character', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    writeFileSync(join(f.pack, 'pack.json'), JSON.stringify({ ...f.manifest, config: '../outside.jsonc' }));
    assert.throws(() => configureCompanion(f.app, f.source), /清单无效/);
    assert.equal(existsSync(join(f.destination, 'chatgpt-dragon-config.jsonc')), false);
    writeFileSync(join(f.pack, 'pack.json'), JSON.stringify(f.manifest));
    const outside = join(root, 'outside.webm');
    writeFileSync(outside, 'outside must not be copied');
    symlinkSync(outside, join(f.animation, 'linked.webm'));
    assert.throws(() => configureCompanion(f.app, f.source), /动画文件无效/);
    assert.equal(existsSync(join(f.destination, 'chatgpt-dragon-config.jsonc')), false);
  });
});

test('built-in install refuses destination symlinks without touching the external directory', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, f.destination);
    assert.throws(() => configureCompanion(f.app, f.source), /目录无效/);
    assert.equal(existsSync(join(outside, 'chatgpt-dragon-config.jsonc')), false);
  });
});
