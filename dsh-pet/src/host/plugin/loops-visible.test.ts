import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerLoops, type LoopsInput } from './loops.ts';

const pet = (id: string, display: string) => ({
  id,
  name: id,
  display,
  size: 420,
  balanceEnabled: false,
  whisperEnabled: true,
  position: { corner: 'bottom-right', marginX: 40, marginY: 65 },
});

function whisperTick(companion: boolean, mainDisplay: string, dragonDisplay: string) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-whisper-visible-'));
  const previous = process.env.DSH_PET_COMPANION;
  const calls: string[] = [];
  const timestamps = new Map<string, number>();
  const warnings: string[] = [];
  const cleanups: Array<() => void> = [];
  if (companion) process.env.DSH_PET_COMPANION = '1';
  else delete process.env.DSH_PET_COMPANION;
  try {
    const petDir = join(root, 'pet');
    mkdirSync(petDir);
    const userFile = join(root, 'main-config.jsonc');
    writeFileSync(userFile, JSON.stringify({ pets: [pet('main', mainDisplay)] }));
    writeFileSync(
      join(petDir, 'chatgpt-dragon-config.jsonc'),
      JSON.stringify({ pets: [pet('chatgpt-dragon', dragonDisplay)] }),
    );
    registerLoops({
      ctx: {
        effect: (setup: () => () => void, name: string) => {
          // Execute the actual scheduled whisper callback without starting balance I/O.
          if (name === 'dsh-pet: whisper poll') cleanups.push(setup());
        },
      },
      configPaths: {
        defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
        userFile,
        petDir,
      },
      lastWhisperAt: timestamps,
      lock: { locked: () => false },
      log: {
        info() {},
        warn: (message: string) => {
          warnings.push(message);
        },
      },
      publishWhisper: async (id: string) => {
        calls.push(id);
        return { ok: true, text: 'fixture' };
      },
      standaloneAiPolicy: () => ({ isReady: () => true, canWhisper: () => true, whisperIntervalSec: () => 300 }),
      balancePeriodSec: () => 1800,
      whisperPeriodSec: () => 300,
      refreshBalance: async () => {},
    } as unknown as LoopsInput);
    assert.deepEqual(warnings, [], 'the real loop should complete rather than silently fail during configuration read');
    return { calls, timestampIds: [...timestamps.keys()] };
  } finally {
    for (const cleanup of cleanups) cleanup();
    if (previous === undefined) delete process.env.DSH_PET_COMPANION;
    else process.env.DSH_PET_COMPANION = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('Codex automatic whispers call only the visible selected character and do not advance the hidden character clock', () => {
  assert.deepEqual(whisperTick(true, 'none', 'desktop'), {
    calls: ['chatgpt-dragon'],
    timestampIds: ['chatgpt-dragon'],
  });
  assert.deepEqual(whisperTick(true, 'desktop', 'none'), {
    calls: ['main'],
    timestampIds: ['main'],
  });
  assert.deepEqual(whisperTick(true, 'none', 'both'), {
    calls: ['chatgpt-dragon'],
    timestampIds: ['chatgpt-dragon'],
  });
});

test('Codex generates nothing when all characters are hidden', () => {
  assert.deepEqual(whisperTick(true, 'none', 'none'), { calls: [], timestampIds: [] });
});

test('DSH retains its original scheduling for hidden and web characters', () => {
  assert.deepEqual(whisperTick(false, 'none', 'web'), {
    calls: ['main', 'chatgpt-dragon'],
    timestampIds: ['main', 'chatgpt-dragon'],
  });
});
