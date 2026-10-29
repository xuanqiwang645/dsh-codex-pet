import assert from 'node:assert/strict';
import fs, {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
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

const hash = (content: string) => createHash('sha256').update(content).digest('hex');

test('only trusted prior bundled media is upgraded atomically, with one recoverable backup and unchanged config', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const config = join(f.destination, 'chatgpt-dragon-config.jsonc');
    const customizedConfig =
      '// retain name, visibility and custom settings\n{"pets":[{"id":"chatgpt-dragon","display":"desktop","size":520}],"custom":"keep"}\n';
    writeFileSync(config, customizedConfig);
    const targetDir = join(f.destination, 'chatgpt-dragon-animation');
    const target = join(targetDir, '待机.webm');
    const previousHash = hash(readFileSync(target, 'utf8'));
    writeFileSync(join(f.animation, '待机.webm'), 'corrected bundled animation');
    writeFileSync(
      join(f.pack, 'pack.json'),
      JSON.stringify({ ...f.manifest, previousAnimationHashes: { '待机.webm': previousHash } }),
    );
    configureCompanion(f.app, f.source);
    assert.equal(readFileSync(target, 'utf8'), 'corrected bundled animation');
    assert.equal(readFileSync(config, 'utf8'), customizedConfig);
    const backups = readdirSync(targetDir).filter((name) => name.includes('.bundled-backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(targetDir, backups[0]), 'utf8'), 'fixture animation');
    configureCompanion(f.app, f.source);
    assert.deepEqual(
      readdirSync(targetDir).filter((name) => name.includes('.bundled-backup-')),
      backups,
      'already-current media must not generate more backups',
    );
  });
});

test('a changed user animation hash is preserved even when a trusted bundled predecessor is declared', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const targetDir = join(f.destination, 'chatgpt-dragon-animation');
    const target = join(targetDir, '待机.webm');
    const previousHash = hash('fixture animation');
    writeFileSync(target, 'custom animation edited by user');
    writeFileSync(join(f.animation, '待机.webm'), 'corrected bundled animation');
    writeFileSync(
      join(f.pack, 'pack.json'),
      JSON.stringify({ ...f.manifest, previousAnimationHashes: { '待机.webm': previousHash } }),
    );
    configureCompanion(f.app, f.source);
    assert.equal(readFileSync(target, 'utf8'), 'custom animation edited by user');
    assert.deepEqual(readdirSync(targetDir), ['待机.webm']);
  });
});

test('prior media hashes reject unsafe names, unknown files and malformed values before any install', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    for (const previousAnimationHashes of [
      null,
      [],
      { '../outside.webm': hash('old') },
      { 'folder\\outside.webm': hash('old') },
      { '.hidden.webm': hash('old') },
      { 'not-bundled.webm': hash('old') },
      { '待机.webm': 'not-a-sha256' },
      { '待机.webm': [hash('old')] },
    ]) {
      writeFileSync(join(f.pack, 'pack.json'), JSON.stringify({ ...f.manifest, previousAnimationHashes }));
      assert.throws(() => configureCompanion(f.app, f.source), /旧素材清单无效/);
      assert.equal(existsSync(join(f.destination, 'chatgpt-dragon-config.jsonc')), false);
      assert.equal(existsSync(join(f.destination, 'chatgpt-dragon-animation', '待机.webm')), false);
    }
  });
});

test('an interrupted upgrade rolls back replacements and new files while retaining user configuration', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const targetDir = join(f.destination, 'chatgpt-dragon-animation');
    const config = join(f.destination, 'chatgpt-dragon-config.jsonc');
    const configBefore = readFileSync(config, 'utf8');
    writeFileSync(join(targetDir, 'A.webm'), 'old A');
    writeFileSync(join(targetDir, 'C.webm'), 'old C');
    writeFileSync(join(f.animation, 'A.webm'), 'new A');
    writeFileSync(join(f.animation, 'B.webm'), 'new B');
    writeFileSync(join(f.animation, 'C.webm'), 'new C');
    writeFileSync(
      join(f.pack, 'pack.json'),
      JSON.stringify({ ...f.manifest, previousAnimationHashes: { 'A.webm': hash('old A'), 'C.webm': hash('old C') } }),
    );
    const rename = fs.renameSync;
    mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
      if (String(source).endsWith('.bundled-update.tmp') && String(target).endsWith('/C.webm'))
        throw new Error('fixture upgrade failure');
      return rename(source, target);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => configureCompanion(f.app, f.source), /fixture upgrade failure/);
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.equal(readFileSync(join(targetDir, 'A.webm'), 'utf8'), 'old A');
    assert.equal(readFileSync(join(targetDir, 'C.webm'), 'utf8'), 'old C');
    assert.equal(existsSync(join(targetDir, 'B.webm')), false);
    assert.deepEqual(readdirSync(targetDir).sort(), ['A.webm', 'C.webm', '待机.webm']);
    assert.equal(readFileSync(config, 'utf8'), configBefore);
  });
});

const stableDragMotion = { mode: 'stable', responseMs: 100, lockFacing: true };

/** A new app ships this behavior, while a previously installed 0.4.3 config lacks it. */
function addBundledDragDefault(pack: string) {
  const path = join(pack, 'chatgpt-dragon-config.jsonc');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.pets[0].dragMotion = stableDragMotion;
  writeFileSync(path, JSON.stringify(config));
}

test('upgrading an existing 0.4.3 character adds only the missing drag default and retains an exact original backup', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const target = join(f.destination, 'chatgpt-dragon-config.jsonc');
    const previous = {
      pets: [
        {
          id: 'chatgpt-dragon',
          name: 'My dragon',
          display: 'desktop',
          size: 520,
          fixedEnabled: true,
          position: { corner: 'top-left', marginX: 123, marginY: 45 },
          customPetField: ['keep', { value: 7 }],
        },
        { id: 'another-character', size: 300 },
      ],
      whisperPrompt: 'Keep my own persona // verbatim',
      animations: { custom: 'do not replace pools' },
      customRootField: { nested: [1, true, null] },
    };
    const originalBytes = '// original 0.4.3 configuration\n' + JSON.stringify(previous) + '\n';
    writeFileSync(target, originalBytes);
    addBundledDragDefault(f.pack);
    configureCompanion(f.app, f.source);
    const after = JSON.parse(readFileSync(target, 'utf8'));
    assert.deepEqual(after, {
      ...previous,
      pets: [{ ...previous.pets[0], dragMotion: stableDragMotion }, previous.pets[1]],
    });
    const backups = readdirSync(f.destination).filter((name) => name.includes('.bundled-backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(f.destination, backups[0]), 'utf8'), originalBytes);
    const migratedBytes = readFileSync(target, 'utf8');
    configureCompanion(f.app, f.source);
    assert.equal(readFileSync(target, 'utf8'), migratedBytes, 'later launches must not rewrite the configuration');
    assert.deepEqual(
      readdirSync(f.destination).filter((name) => name.includes('.bundled-backup-')),
      backups,
    );
  });
});

test('existing custom drag settings, explicit nulls and unreadable user configuration remain byte-for-byte unchanged', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    addBundledDragDefault(f.pack);
    const target = join(f.destination, 'chatgpt-dragon-config.jsonc');
    for (const dragMotion of [
      { mode: 'stable', responseMs: 250, lockFacing: false },
      { mode: 'my-custom-mode', extra: ['keep'] },
      null,
      false,
    ]) {
      const original =
        '// preserve custom behavior\n' +
        JSON.stringify({ pets: [{ id: 'chatgpt-dragon', display: 'desktop', dragMotion }], custom: 'keep' }) +
        '\n';
      writeFileSync(target, original);
      configureCompanion(f.app, f.source);
      assert.equal(readFileSync(target, 'utf8'), original);
    }
    const broken = '// user is editing this file\n{"pets": [';
    writeFileSync(target, broken);
    configureCompanion(f.app, f.source);
    assert.equal(readFileSync(target, 'utf8'), broken);
    assert.deepEqual(
      readdirSync(f.destination).filter((name) => name.includes('.bundled-backup-')),
      [],
    );
  });
});

test('failed config migration restores old media and original config bytes, and removes newly installed clips', async () => {
  await isolatedBootstrap((root) => {
    const f = packFixture(root);
    configureCompanion(f.app, f.source);
    const config = join(f.destination, 'chatgpt-dragon-config.jsonc');
    const originalConfig = '// 0.4.3 user data\n{"pets":[{"id":"chatgpt-dragon","display":"desktop"}],"custom":7}\n';
    writeFileSync(config, originalConfig);
    addBundledDragDefault(f.pack);
    const targetDir = join(f.destination, 'chatgpt-dragon-animation');
    const animation = join(targetDir, '待机.webm');
    writeFileSync(join(f.animation, '待机.webm'), 'corrected bundled animation');
    writeFileSync(join(f.animation, '新动作.webm'), 'new bundled animation');
    writeFileSync(
      join(f.pack, 'pack.json'),
      JSON.stringify({ ...f.manifest, previousAnimationHashes: { '待机.webm': hash('fixture animation') } }),
    );
    const rename = fs.renameSync;
    let configPublishAttempted = false;
    mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
      if (String(source).endsWith('.bundled-update.tmp') && String(target) === config) {
        configPublishAttempted = true;
        assert.equal(readFileSync(animation, 'utf8'), 'corrected bundled animation');
        throw new Error('fixture config migration failure');
      }
      return rename(source, target);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => configureCompanion(f.app, f.source), /fixture config migration failure/);
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.equal(configPublishAttempted, true);
    assert.equal(readFileSync(config, 'utf8'), originalConfig);
    assert.equal(readFileSync(animation, 'utf8'), 'fixture animation');
    assert.deepEqual(readdirSync(targetDir), ['待机.webm']);
    assert.deepEqual(readdirSync(f.destination).sort(), ['chatgpt-dragon-animation', 'chatgpt-dragon-config.jsonc']);
  });
});
