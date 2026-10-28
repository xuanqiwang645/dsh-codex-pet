import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { flattenPetList, readAllConfig, saveUserConfig } from '../host/config.ts';
import { setPetDisplay } from '../host/routes/config/display.ts';
import type { PetRouteDeps, RouteInput } from '../host/routes/types.ts';

const defaultFile = fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url));
const pet = (id: string, display: string) => ({
  id,
  name: id,
  size: 420,
  balanceEnabled: true,
  fixedEnabled: true,
  display,
  position: { corner: 'bottom-right', marginX: 40, marginY: 65 },
});

test('Codex recovers obsolete web modes in all config layers while preserving hidden pets and file bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-display-'));
  const previous = process.env.DSH_PET_COMPANION;
  try {
    const paths = { defaultFile, userFile: join(root, 'main-config.jsonc'), petDir: join(root, 'pet') };
    mkdirSync(paths.petDir);
    const main =
      '// preserve this comment\n' +
      JSON.stringify({
        pets: [pet('web', 'web'), pet('both', 'both'), pet('hidden', 'none'), pet('visible', 'desktop')],
        whisperPrompt: 'preserve persona',
      });
    const packFile = join(paths.petDir, 'extra-config.jsonc');
    const pack = JSON.stringify({ pets: [pet('extra', 'web')] });
    writeFileSync(paths.userFile, main);
    writeFileSync(packFile, pack);
    process.env.DSH_PET_COMPANION = '1';
    const pets = flattenPetList(readAllConfig(paths));
    assert.deepEqual(
      pets.map(({ id, display }) => [id, display]),
      [
        ['web', 'desktop'],
        ['both', 'desktop'],
        ['hidden', 'none'],
        ['visible', 'desktop'],
        ['extra', 'desktop'],
      ],
    );
    assert.ok(pets.every((item) => item.size === 420 && item.fixedEnabled === true));
    assert.equal(readFileSync(paths.userFile, 'utf8'), main);
    assert.equal(readFileSync(packFile, 'utf8'), pack);
    assert.equal(readAllConfig(paths).main.whisperPrompt, 'preserve persona');
    // Reset/default paths also used to inherit the upstream web-only default.
    const defaultPets = flattenPetList(
      readAllConfig({ ...paths, userFile: join(root, 'absent'), petDir: join(root, 'absent-pets') }),
    );
    assert.ok(defaultPets.every((item) => item.display === 'desktop'));
    delete process.env.DSH_PET_COMPANION;
    assert.equal(flattenPetList(readAllConfig(paths))[0].display, 'web');
    assert.equal(flattenPetList(readAllConfig(paths))[1].display, 'both');
  } finally {
    if (previous === undefined) delete process.env.DSH_PET_COMPANION;
    else process.env.DSH_PET_COMPANION = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Codex config saves reject removed modes while DSH retains all original modes', () => {
  const previous = process.env.DSH_PET_COMPANION;
  try {
    process.env.DSH_PET_COMPANION = '1';
    for (const display of ['web', 'both']) assert.equal(saveUserConfig({ pets: [pet('main', display)] }), null);
    for (const display of ['desktop', 'none']) assert.ok(saveUserConfig({ pets: [pet('main', display)] }));
    delete process.env.DSH_PET_COMPANION;
    for (const display of ['web', 'both', 'desktop', 'none'])
      assert.ok(saveUserConfig({ pets: [pet('main', display)] }));
  } finally {
    if (previous === undefined) delete process.env.DSH_PET_COMPANION;
    else process.env.DSH_PET_COMPANION = previous;
  }
});

test('removed display requests cannot write files, release locks or restart the companion', async () => {
  const previous = process.env.DSH_PET_COMPANION;
  try {
    process.env.DSH_PET_COMPANION = '1';
    const deps = new Proxy({} as PetRouteDeps, {
      get(_target, name) {
        throw new Error('rejected display must not access runtime dependency ' + String(name));
      },
    });
    for (const display of ['web', 'both']) {
      const input: RouteInput = {
        url: new URL('http://127.0.0.1/dsh-pet-7340/pet-display'),
        method: 'POST',
        rest: 'pet-display',
        body: JSON.stringify({ id: 'main', display }),
      };
      const result = await setPetDisplay(deps, input);
      assert.equal(result.kind, 'json');
      if (result.kind !== 'json') throw new Error('expected JSON');
      assert.equal((result.obj as { ok: boolean }).ok, false);
      assert.match((result.obj as { message: string }).message, /desktop \/ none/);
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_PET_COMPANION;
    else process.env.DSH_PET_COMPANION = previous;
  }
});
