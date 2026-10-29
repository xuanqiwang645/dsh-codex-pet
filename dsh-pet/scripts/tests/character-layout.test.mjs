import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alphaComponents, detectAlphaLayout, planFrameCanvas } from '../character-layout.mjs';

function fixture(width = 100, height = 100) {
  const alpha = new Uint8Array(width * height);
  return {
    alpha,
    width,
    height,
    rect(left, top, right, bottom, value = 255) {
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) alpha[y * width + x] = value;
      return this;
    },
  };
}
const detect = (f, options = {}) => detectAlphaLayout(f.alpha, f.width, f.height, { columns: 2, rows: 2, ...options });

test('detects whole nonuniform figures across the old equal-grid boundaries in playback order', () => {
  const f = fixture().rect(8, 3, 30, 55).rect(64, 5, 88, 53).rect(7, 63, 31, 94).rect(62, 62, 89, 92);
  const layout = detect(f);
  assert.deepEqual(
    layout.frames.map((frame) => frame.bounds),
    [
      [8, 3, 30, 55],
      [64, 5, 88, 53],
      [7, 63, 31, 94],
      [62, 62, 89, 92],
    ],
  );
  assert.deepEqual(layout.frames[0].crop, [6, 1, 32, 57]);
});

test('preserves pose height differences under one atlas scale and a shared feet baseline', () => {
  const f = fixture().rect(8, 4, 30, 54).rect(64, 5, 88, 45).rect(7, 63, 31, 94).rect(62, 62, 89, 92);
  const layout = planFrameCanvas(detect(f));
  assert.equal(layout.scale, 6);
  assert.notEqual(layout.frames[0].canvas.scaledHeight, layout.frames[1].canvas.scaledHeight);
  for (const frame of layout.frames)
    assert.equal(frame.canvas.y + Math.round((frame.bounds[3] - frame.crop[1]) * layout.scale), 330);
});

test('rejects source-edge clipping and insufficient antialias clearance', () => {
  for (const top of [0, 1]) {
    const f = fixture().rect(8, top, 30, 40).rect(64, 5, 88, 45).rect(7, 63, 31, 94).rect(62, 62, 89, 92);
    assert.throws(() => detect(f), /source edge/);
  }
});

test('rejects connected neighbouring figures instead of treating them as a crop', () => {
  const f = fixture().rect(8, 4, 30, 49).rect(8, 49, 31, 94).rect(64, 5, 88, 45).rect(62, 62, 89, 92);
  assert.throws(() => detect(f), /Expected 4 separate figures, found 3/);
});

test('rejects an apparently correct figure count with a missing column and duplicate row', () => {
  const f = fixture().rect(8, 4, 30, 35).rect(7, 43, 31, 64).rect(7, 72, 31, 95).rect(62, 70, 89, 94);
  assert.throws(() => detect(f), /order is ambiguous/);
});

test('rejects an adjacent small foot fragment inside the antialias crop', () => {
  const f = fixture()
    .rect(8, 4, 30, 45)
    .rect(64, 5, 88, 45)
    .rect(7, 63, 31, 94)
    .rect(62, 62, 89, 92)
    .rect(31, 12, 32, 20);
  assert.throws(() => detect(f), /unassigned or neighbouring/);
});

test('does not assume a detached fragment inside a broad figure rectangle belongs to that figure', () => {
  const f = fixture()
    .rect(8, 4, 30, 45)
    .rect(15, 12, 23, 26, 0)
    .rect(18, 15, 20, 22)
    .rect(64, 5, 88, 45)
    .rect(7, 63, 31, 94)
    .rect(62, 62, 89, 92);
  assert.throws(() => detect(f), /unassigned or neighbouring/);
});

test('does not silently discard detached visible parts outside all figure bounds', () => {
  const f = fixture()
    .rect(8, 4, 30, 45)
    .rect(64, 5, 88, 45)
    .rect(7, 63, 31, 94)
    .rect(62, 62, 89, 92)
    .rect(35, 12, 38, 20);
  assert.throws(() => detect(f), /unassigned visible component/);
  const regions = [
    [5, 2, 40, 48],
    [60, 2, 91, 48],
    [4, 60, 34, 97],
    [59, 59, 92, 95],
  ];
  const layout = detect(f, { reviewedRegions: regions });
  assert.equal(layout.frames[0].componentIds.length, 2);
  assert.deepEqual(layout.frames[0].bounds, [8, 4, 38, 45]);
});

test('reviewed rectangles cannot cut components or include a neighbouring body', () => {
  const f = fixture().rect(8, 4, 30, 45).rect(64, 5, 88, 45).rect(7, 63, 31, 94).rect(62, 62, 89, 92);
  const regions = [
    [5, 2, 25, 48],
    [60, 2, 91, 48],
    [4, 60, 34, 97],
    [59, 59, 92, 95],
  ];
  assert.throws(() => detect(f, { reviewedRegions: regions }), /cuts a connected/);
  regions[0] = [5, 2, 91, 48];
  assert.throws(() => detect(f, { reviewedRegions: regions }), /exactly one complete figure/);
});

test('uses alpha >32 and validates the raw gray byte count', () => {
  const f = fixture(6, 6).rect(1, 1, 2, 2, 32).rect(3, 3, 4, 4, 33);
  assert.equal(alphaComponents(f.alpha, 6, 6).components.length, 1);
  assert.deepEqual(alphaComponents(f.alpha, 6, 6).components[0].bounds, [3, 3, 4, 4]);
  assert.throws(() => alphaComponents(f.alpha.slice(1), 6, 6), /byte count/);
});
