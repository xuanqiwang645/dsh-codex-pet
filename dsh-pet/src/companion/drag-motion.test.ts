import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mergeEntry } from '../host/config/merge.ts';
import { saveUserConfig } from '../host/config/save.ts';
import { dragMotionValid } from '../host/config/validate.ts';
import { readJsonc } from '../host/config/jsonc.ts';
import { stableDragStep, springStep } from '../shared/physics.ts';
import { flattenConfigPets } from '../shared/config.ts';
import type { DragMotion } from '../shared/types.ts';

const source = (name: string): string =>
  readFileSync(new URL('../../runtime/electron-helper/' + name, import.meta.url), 'utf8');
const profile: DragMotion = { mode: 'stable', responseMs: 100, lockFacing: true };
const base = readJsonc(fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)))!;

test('stable dragging is optional per character and survives read, flatten and old settings writes', () => {
  const defaults = base.pets as Array<Record<string, unknown>>;
  const dragon = { ...defaults[0], id: 'dragon', dragMotion: profile };
  const whale = { ...defaults[0], id: 'whale' };
  const merged = mergeEntry(base, { pets: [dragon, whale] }, 'test', defaults, new Set());
  const pets = merged.pets as Array<Record<string, unknown>>;
  assert.deepEqual(pets[0].dragMotion, profile);
  assert.equal('dragMotion' in pets[1], false);
  const flattened = flattenConfigPets({ test: merged });
  assert.deepEqual(flattened[0].dragMotion, profile);
  assert.equal('dragMotion' in flattened[1], false);
  const oldEditor: Record<string, unknown> = { ...dragon };
  delete oldEditor.dragMotion;
  const saved = saveUserConfig({ pets: [oldEditor, whale] }, { pets: [dragon, whale] });
  assert.deepEqual((saved?.pets[0] as Record<string, unknown>).dragMotion, profile);
  assert.equal('dragMotion' in (saved?.pets[1] as Record<string, unknown>), false);
  for (const invalid of [
    null,
    [],
    { mode: 'stable', responseMs: 0 },
    { mode: 'spring' },
    { mode: 'stable', lockFacing: 1 },
  ]) {
    assert.equal(dragMotionValid(invalid), false);
    assert.equal(saveUserConfig({ pets: [{ ...dragon, dragMotion: invalid }] }), null);
  }
  const actual = JSON.parse(
    readFileSync(new URL('../../assets/pet-packs/chatgpt-dragon/chatgpt-dragon-config.jsonc', import.meta.url), 'utf8'),
  );
  assert.deepEqual(actual.pets[0].dragMotion, profile);
});

type MotionSprite = {
  pet: { id: string; dragMotion?: DragMotion };
  pos: { x: number; y: number };
  dragTarget: { x: number; y: number } | null;
  dragVel: { vx: number; vy: number };
  dragFollow: number | null;
  dragFollowToken: number;
  startDragFollow(): void;
  stopDragFollow(): void;
  onPointerMove(event: { screenX: number; screenY: number }): void;
  stage: { style: { transform: string } };
  facing: string;
  videoA: { style: { transform: string; transformOrigin: string } };
  videoB: { style: { transform: string; transformOrigin: string } };
};

function motionHarness(dragMotion?: DragMotion, power = 1) {
  const prototype = {};
  let time = 0;
  let sequence = 0;
  let squashesStopped = 0;
  const frames = new Map<number, () => void>();
  const positions: number[] = [];
  runInNewContext(source('sprite/motion.js') + '\n' + source('sprite/input.js'), {
    PetSprite: { prototype },
    S: {
      stableDragStep,
      springStep,
      DRAG_THRESHOLD: 5,
      pick: (pool: string[]) => pool[0],
      trimTrail: (trail: unknown) => trail,
    },
    performance: { now: () => time },
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    toLocal: (value: number) => value,
  });
  const sprite = Object.assign(Object.create(prototype), {
    pet: { id: 'arbitrary-character', dragMotion },
    physics: { throwPower: power },
    pos: { x: 0, y: 0 },
    dragTarget: null,
    dragVel: { vx: 0, vy: 0 },
    dragFollow: null,
    dragFollowToken: 0,
    dragState: { active: true, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 },
    dragTrail: [],
    facing: 'right',
    stage: { style: { transform: 'translateY(20px)' } },
    videoA: { style: { transform: 'scaleY(0.5)', transformOrigin: 'bottom' } },
    videoB: { style: { transform: '', transformOrigin: '' } },
    animations: { drag: ['gentle-hold'] },
    stopSquash: () => squashesStopped++,
    syncInputBusy() {},
    playOnce() {},
    sendBounds(x: number, y: number) {
      this.pos = { x: Math.round(x), y: Math.round(y) };
      positions.push(this.pos.x);
    },
  }) as MotionSprite;
  const tick = (dt: number) => {
    time += dt;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  };
  return { sprite, positions, tick, squashesStopped: () => squashesStopped, frameCount: () => frames.size };
}

test('real desktop stable follow reaches the pointer with rounded window IPC and does not swing when the pointer reverses', () => {
  for (const power of [0.1, 1, 3]) {
    const { sprite, tick, positions, frameCount } = motionHarness(profile, power);
    sprite.onPointerMove({ screenX: 80, screenY: 0 });
    for (let frame = 0; frame < 60; frame++) tick(1000 / 30);
    assert.equal(sprite.pos.x, 80);
    assert.ok(positions.every((x, i) => x >= (positions[i - 1] ?? 0) && x <= 80));
    sprite.onPointerMove({ screenX: -40, screenY: 0 });
    for (let frame = 0; frame < 60; frame++) tick(1000 / 30);
    assert.equal(sprite.pos.x, -40);
    assert.ok(positions.slice(60).every((x, i, values) => x <= (values[i - 1] ?? 80) && x >= -40));
    sprite.stopDragFollow();
    assert.equal(frameCount(), 0);
    const released = sprite.pos.x;
    tick(1000);
    assert.equal(sprite.pos.x, released, 'a stale frame must not move a released character');
  }
});

test('stable dragging preserves the grab anchor and cancels squash, while the unconfigured whale keeps its previous motion', () => {
  const stable = motionHarness(profile);
  stable.sprite.onPointerMove({ screenX: 80, screenY: 0 });
  assert.equal(stable.sprite.stage.style.transform, 'translateY(20px)');
  assert.equal(stable.squashesStopped(), 1);
  assert.equal(stable.sprite.videoA.style.transform, 'scaleX(-1)');
  assert.equal(stable.sprite.videoA.style.transformOrigin, '');
  const original = motionHarness();
  original.sprite.onPointerMove({ screenX: 80, screenY: 0 });
  original.tick(1000 / 60);
  assert.equal(original.sprite.stage.style.transform, 'none');
  assert.equal(original.squashesStopped(), 0);
  const velocity = springStep(0, 0, 80, 1 / 60, 1);
  assert.equal(original.sprite.pos.x, Math.round(velocity / 60), 'the original whale follow formula is unchanged');
});

test('real sprite accessor locks stable character facing during the grab and releases it afterwards', () => {
  const context: Record<string, unknown> = { navigator: { platform: 'Mac' }, BASE: '' };
  runInNewContext(source('sprite.js') + '\nglobalThis.SpriteClass = PetSprite;', context);
  const ctor = context.SpriteClass as { prototype: object };
  const sprite = Object.assign(Object.create(ctor.prototype), {
    pet: { dragMotion: profile },
    dragState: { active: true },
    _facing: 'left',
    markPoseDirty() {},
  });
  sprite.facing = 'right';
  assert.equal(sprite.facing, 'left');
  sprite.dragState.active = false;
  sprite.facing = 'right';
  assert.equal(sprite.facing, 'right');
  sprite.pet.dragMotion = undefined;
  sprite.dragState.active = true;
  sprite.facing = 'left';
  assert.equal(sprite.facing, 'left', 'the existing whale facing behavior remains unchanged');
});
