import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gentlePoseSequences, planInterpolation } from '../character-interpolation.mjs';

const refs = Array.from({ length: 8 }, (_, sourceFrame) => ({ source: 'walk-cycle.png', sourceFrame }));
test('a restrained turn keeps eight selected source anchors and its original duration', () => {
  const plan = planInterpolation(
    gentlePoseSequences.turn.map((sourceFrame) => ({ source: 'turn-cycle-v2.png', sourceFrame })),
    8,
  );
  assert.deepEqual(
    plan.anchors.map((anchor) => anchor.sourceFrame),
    [0, 1, 0, 7, 0, 1, 0, 0],
  );
  assert.equal(plan.totalFrames, 64);
});
test('a restrained wing gesture excludes the large unfolding poses while preserving timing', () => {
  const plan = planInterpolation(
    gentlePoseSequences.wings.map((sourceFrame) => ({ source: 'wings-drag-cycle-v2.png', sourceFrame })),
    12,
  );
  assert.deepEqual(
    plan.anchors.map((anchor) => anchor.sourceFrame),
    [0, 1, 5, 6, 7, 6, 5, 0],
  );
  assert.equal(plan.totalFrames, 96);
});
test('every walking source pose remains an exact output anchor at 48fps', () => {
  const plan = planInterpolation(refs, 6, true);
  assert.equal(plan.totalFrames, 48);
  assert.equal(plan.inputFrameRate, '48/6');
  assert.deepEqual(
    plan.anchors.map((anchor) => anchor.frame),
    [0, 6, 12, 18, 24, 30, 36, 42],
  );
  assert.deepEqual(
    plan.anchors.map((anchor) => anchor.sourceFrame),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(plan.intervals.at(-1).right.sourceFrame, 0);
});
test('one-shot gestures retain their final pose and exact source anchors', () => {
  const plan = planInterpolation(refs, 12);
  assert.equal(plan.totalFrames, 96);
  assert.equal(plan.intervals.at(-1).endFrame, 96);
  assert.equal(plan.intervals.at(-1).right.sourceFrame, 7);
});
test('rejects duplicate-frame-only plans and missing motion endpoints', () => {
  assert.throws(() => planInterpolation(refs, 1), /at least three/);
  assert.throws(() => planInterpolation(refs.slice(0, 1), 6), /multiple anchors/);
});
