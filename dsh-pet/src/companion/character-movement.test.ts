import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { readAllConfig } from '../host/config.ts';
import { flattenConfigPets } from '../shared/config.ts';
import { PET_REF_WIDTH } from '../shared/constants.ts';
import { planMove } from '../shared/motion.ts';
import * as pickers from '../shared/pickers.ts';
import { buildMenuTree } from '../shared/menu/tree.ts';
import type { MenuNode } from '../shared/menu/types.ts';
import type { Pet } from '../shared/types.ts';

const configSource = fileURLToPath(
  new URL('../../assets/pet-packs/chatgpt-dragon/chatgpt-dragon-config.jsonc', import.meta.url),
);
const defaultFile = fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url));
const playbackSource = readFileSync(
  new URL('../../runtime/electron-helper/sprite/playback.js', import.meta.url),
  'utf8',
);

/** Load the actual shipping pack through the same merge/flatten pipeline as the desktop. */
function dragonPet(): Pet {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dragon-movement-'));
  try {
    const userFile = join(root, 'main-config.jsonc');
    const petDir = join(root, 'pet');
    mkdirSync(petDir);
    writeFileSync(userFile, JSON.stringify({ pets: [{ id: 'main', name: '鲸鱼娘', display: 'none' }] }));
    copyFileSync(configSource, join(petDir, 'chatgpt-dragon-config.jsonc'));
    const pet = flattenConfigPets(readAllConfig({ defaultFile, userFile, petDir })).find(
      (pet) => pet.id === 'chatgpt-dragon',
    );
    assert.ok(pet);
    return pet;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('shipping dragon pack enables roaming and retains its own complete animation pools and persona', () => {
  const pet = dragonPet();
  assert.equal(pet.fixedEnabled, false);
  assert.equal(pet.assetRoot, 'chatgpt-dragon');
  assert.deepEqual(pet.animations?.idle, ['白龙待机灵动']);
  assert.deepEqual(pet.animations?.turn, ['白龙回首转身']);
  assert.deepEqual(pet.animations?.drag, ['白龙悬空轻扶']);
  assert.deepEqual(pet.animations?.moves.actions, [{ name: '白龙轻快行走' }]);
  for (const name of [
    ...pet.animations!.idle,
    ...pet.animations!.turn,
    ...pet.animations!.moves.actions.map((action) => action.name),
  ]) {
    assert.equal(
      pickers.isEventAnim(pet.animations!.events, name),
      false,
      'random-chain clips must not be classified as event-only clips',
    );
  }
  const raw = JSON.parse(readFileSync(configSource, 'utf8'));
  assert.deepEqual(pet.animations, raw.animations, 'invalid pack sections must not fall back to whale animations');
  assert.match(raw.whisperPrompt, /ChatGPT白龙娘/);
  assert.match(raw.whisperPrompt, /温柔从容、礼貌克制/);
  assert.match(raw.whisperPrompt, /优雅而有分寸/);
  assert.match(raw.whisperPrompt, /学习问题时认真回答/);
  assert.doesNotMatch(raw.whisperPrompt, /主人|蓝发|女仆|撒娇|大跳/);
  assert.equal(raw.workStatusTexts.length, 6);
  assert.deepEqual(
    pet.workStatusTexts,
    raw.workStatusTexts,
    'visible status phrases must retain the dragon tone instead of inheriting whale phrases',
  );
  const categories = pet.animations!.categories;
  assert.equal(
    categories.reduce((sum, category) => sum + category.weight, 0),
    35,
  );
  assert.ok(categories.every((category) => Number.isFinite(category.weight) && category.weight > 0));
  assert.ok(categories.some((category) => category.actions.includes('白龙提裙轻礼')));
  assert.ok(categories.some((category) => category.actions.includes('白龙从容抿茶')));
  const counts = { idle: 0, turn: 0, move: 0, action: 0 };
  for (let i = 0; i < 1000; i++)
    counts[pickers.rollKind((i + 0.5) / 1000, pet.animationWeights!, { fixed: pet.fixedEnabled })]++;
  assert.deepEqual(counts, { idle: 300, turn: 100, move: 250, action: 350 });
});

test('the actual action menu exposes the elegant dragon repertoire without inherited whale or superseded casual actions', () => {
  const pet = dragonPet();
  const animations = pet.animations!;
  const elegant = [
    '白龙提裙轻礼',
    '白龙拂发整袖',
    '白龙从容抿茶',
    '白龙静心阅卷',
    '白龙舒翼摆尾',
    '白龙优雅颔首',
    '白龙悬空轻扶',
  ];
  const allowed = new Set([...elegant, '白龙待机灵动', '白龙回首转身', '白龙轻快行走', '白龙事件轻语']);
  const leaves = (nodes: readonly MenuNode[]): string[] =>
    nodes.flatMap((node) => {
      if ('children' in node) return leaves(node.children);
      return typeof node.anim === 'string' ? [node.anim] : [];
    });
  const available = leaves(buildMenuTree(animations));
  assert.ok(available.length > 0);
  assert.ok(available.every((name) => allowed.has(name)));
  for (const action of elegant) assert.ok(available.includes(action), action + ' should be selectable in the menu');
  assert.deepEqual(
    animations.categories.map((category) => category.id),
    ['仪态', '茶与书', '舒展'],
  );
  for (const old of ['白龙挥手', '白龙品茶', '白龙轻闭双眼', '白龙悬空摆尾'])
    assert.equal(available.includes(old), false);
  const events = Object.values(animations.events).flat(2);
  assert.ok(events.every((name) => name === '白龙事件轻语' || elegant.includes(name)));
});

function runtimePick(pet: Pet, roll: number, entrypoint = 'playIdle', current?: string) {
  const prototype: Record<string, (...args: unknown[]) => unknown> = {};
  const math = Object.create(Math) as Math;
  math.random = () => roll;
  runInNewContext(playbackSource, {
    Object,
    Math: math,
    PetSprite: { prototype },
    S: { ...pickers, planMove, PET_REF_WIDTH },
    VIEW: { w: 1200, h: 800 },
    AREAS: [{ x: 0, y: 0, width: 1200, height: 800 }],
  });
  const selected: string[] = [];
  const switched: string[] = [];
  const state: Record<string, unknown> = {
    pet,
    animations: pet.animations,
    weights: pet.animationWeights,
    frozen: false,
    dragState: { active: false },
    playback: null,
    workState: null,
    anim: current ?? pet.animations!.idle[0],
    facing: 'left',
    size: pet.size,
    halfW: 120,
    sideAllow: 0,
    confineToScreen: false,
    moveRef: null,
    pendingMove: null,
    throwRef: null,
    stopMove() {},
    currentCenterX: () => 600,
    currentCenterY: () => 500,
    switchTo: (name: string) => {
      switched.push(name);
    },
    playOnce: (name: string) => {
      selected.push(name);
    },
  };
  Object.setPrototypeOf(state, prototype);
  prototype[entrypoint].call(state);
  return {
    selected,
    switched,
    plan: state.pendingMove as { startRatio: number; targetRatio: number; leadSec: number; tailSec: number } | null,
    facing: state.facing,
  };
}

test('desktop random chain starts a real bounded walking plan for the configured dragon action', () => {
  const pet = dragonPet();
  const result = runtimePick(pet, 0.6);
  assert.deepEqual(result.selected, ['白龙轻快行走']);
  assert.deepEqual(result.switched, ['白龙轻快行走']);
  assert.ok(result.plan);
  assert.ok(
    result.plan.targetRatio < result.plan.startRatio,
    'left-facing walk must move left rather than slide in place',
  );
  const distance = (result.plan.startRatio - result.plan.targetRatio) * 1200;
  assert.ok(distance >= Math.floor((80 * pet.size) / PET_REF_WIDTH));
  assert.ok(distance <= Math.ceil((160 * pet.size) / PET_REF_WIDTH));
  assert.equal(result.plan.leadSec, 0.15);
  assert.equal(result.plan.tailSec, 0.2);
  // A user's explicit fixed-position setting still suppresses autonomous roaming.
  const fixed = runtimePick({ ...pet, fixedEnabled: true }, 0.6);
  assert.equal(fixed.plan, null);
  assert.deepEqual(fixed.switched, []);
});

test('desktop random chain can choose idle and turn without taking the walking branch', () => {
  const pet = dragonPet();
  assert.deepEqual(runtimePick(pet, 0.2).selected, ['白龙待机灵动']);
  const turn = runtimePick(pet, 0.35);
  assert.deepEqual(turn.selected, ['白龙回首转身']);
  assert.equal(turn.plan, null);
});

test('ending the real idle, turn or walking clip re-enters random movement instead of looping through event playback', () => {
  const pet = dragonPet();
  for (const animation of ['白龙待机灵动', '白龙回首转身', '白龙轻快行走']) {
    const ended = runtimePick(pet, 0.6, 'handleEnded', animation);
    assert.deepEqual(ended.selected, ['白龙轻快行走'], animation + ' must reach the random chain after ending');
    assert.ok(ended.plan);
    if (animation === '白龙回首转身') {
      assert.equal(ended.facing, 'right');
      assert.ok(
        ended.plan.targetRatio > ended.plan.startRatio,
        'a completed turn should reverse the subsequent walking direction',
      );
    }
  }
});
