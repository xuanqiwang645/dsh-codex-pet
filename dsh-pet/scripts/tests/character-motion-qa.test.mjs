import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeMotionInterval,
  featureDifference,
  rgbaFeature,
  classifyContourFringe,
} from '../character-motion-qa.mjs';

const pose = (value) => new Float32Array([value, value * 0.8, value * 0.6, 1]);

test('records a small translucent contour fringe as a warning with its actual measurements', () => {
  assert.equal(
    classifyContourFringe({ pixels: 79, maxAlpha: 127, farthestBodyDistance: 15, mainShare: 0.9985 }),
    'warning',
  );
});
test('rejects a substantial opaque shoe fragment above the character', () => {
  assert.equal(
    classifyContourFringe({ pixels: 1500, maxAlpha: 255, farthestBodyDistance: 50, mainShare: 0.97 }),
    'failure',
  );
});
test('does not hide opaque or distant small fragments under the antialias warning', () => {
  assert.equal(
    classifyContourFringe({ pixels: 40, maxAlpha: 220, farthestBodyDistance: 3, mainShare: 0.999 }),
    'failure',
  );
  assert.equal(
    classifyContourFringe({ pixels: 40, maxAlpha: 100, farthestBodyDistance: 30, mainShare: 0.999 }),
    'failure',
  );
});
test('keeps missing substantial figure area as a failure even with a soft fragment', () => {
  assert.equal(
    classifyContourFringe({ pixels: 79, maxAlpha: 127, farthestBodyDistance: 15, mainShare: 0.99 }),
    'failure',
  );
});
const interval = (values, options = {}) =>
  analyzeMotionInterval({
    features: values.map(pose),
    leftFeature: pose(0),
    rightFeature: pose(1),
    ...options,
  });

test('normalizes premultiplied RGBA including alpha without unpremultiplying transparent pixels', () => {
  const feature = rgbaFeature(new Uint8Array([64, 32, 0, 128, 0, 0, 0, 0]));
  assert.ok(feature instanceof Float32Array);
  assert.ok(Math.abs(feature[0] - 64 / 255) < 1e-7);
  assert.ok(Math.abs(feature[3] - 128 / 255) < 1e-7);
  assert.deepEqual([...feature.slice(4)], [0, 0, 0, 0]);
  assert.equal(featureDifference(feature, feature), 0);
});

test('measures mean absolute RGBA difference rather than the number of unequal bytes', () => {
  assert.equal(featureDifference(new Float32Array([0, 0, 0, 0]), new Float32Array([1, 0, 0, 1])), 0.5);
});

test('rejects 8 fps held poses repackaged as repeated 48 fps frames', () => {
  const result = interval([0, 0, 0, 0, 0, 0, 1]);
  assert.equal(result.passed, false);
  assert.equal(result.newIntermediatePoses, 0);
  assert.equal(result.longestNearDuplicateRun, 5);
  assert.ok(result.reasons.includes('too-few-intermediate-poses'));
  assert.ok(result.reasons.includes('abrupt-motion-step'));
  assert.ok(result.reasons.includes('repeated-motion-frames'));
});

test('accepts real intermediate poses with small changes between both source anchors', () => {
  const result = interval([0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.equal(result.passed, true);
  assert.equal(result.newIntermediatePoses, 4);
  assert.equal(result.requiredIntermediatePoses, 1);
  assert.equal(result.longestNearDuplicateRun, 0);
  assert.ok(result.maxStepToEndpointRatio < 0.201);
});

test('requires at least two perceptually distinct intermediate poses for a long interval', () => {
  const result = interval([0, 0, 0, 0.5, 0.5, 0.5, 1, 1]);
  assert.equal(result.requiredIntermediatePoses, 2);
  assert.equal(result.newIntermediatePoses, 1);
  assert.equal(result.longestNearDuplicateRun, 2);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['too-few-intermediate-poses']);
  assert.equal(interval(Array.from({ length: 8 }, (_, index) => index / 7)).passed, true);
});

test('rejects a conspicuous wrong-order jump even if many source-like poses are present', () => {
  const result = interval([0, 0.2, 0.8, 0.1, 0.4, 0.6, 0.8, 1]);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('abrupt-motion-step'));
});

test('rejects one abrupt transition despite genuine intermediate poses elsewhere', () => {
  const result = interval([0, 0.1, 0.2, 0.9, 1]);
  assert.ok(result.newIntermediatePoses >= 1);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('abrupt-motion-step'));
});

test('rejects reversed endpoint order rather than accepting an apparently smooth reverse interval', () => {
  const result = interval([1, 0.8, 0.6, 0.4, 0.2, 0]);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('endpoint-frame-mismatch'));
});

test('allows true static holds and small codec variation without demanding invented movement', () => {
  for (const values of [Array(15).fill(0), Array.from({ length: 15 }, (_, index) => (index % 2) * 0.0003)]) {
    const result = interval(values, { rightFeature: pose(0) });
    assert.equal(result.passed, true);
    assert.equal(result.requiredIntermediatePoses, 0);
    assert.equal(result.newIntermediatePoses, 0);
    assert.equal(result.longestNearDuplicateRun, 14);
  }
});

test('does not count imperceptible codec differences as many new intermediate poses', () => {
  const result = interval([0, 0.5, 0.50001, 0.50002, 0.50003, 0.50004, 0.50005, 1]);
  assert.equal(result.newIntermediatePoses, 1);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('repeated-motion-frames'));
});

test('accepts a source endpoint appended to the final loop-tail samples', () => {
  const result = interval([0, 0.3, 0.65, 1]);
  assert.equal(result.passed, true);
  assert.equal(result.newIntermediatePoses, 2);
});

test('rejects malformed inputs before NaN or geometry mismatches can pass motion QA', () => {
  assert.throws(() => rgbaFeature(new Uint8Array(3)), /RGBA/);
  assert.throws(() => featureDifference(new Float32Array(1), new Float32Array(2)), /equal length/);
  assert.throws(() => featureDifference(new Float32Array([NaN]), new Float32Array([0])), /finite/);
  assert.throws(() => interval([0]), /both endpoint/);
  assert.throws(() => interval([0, 1], { noiseFloor: -1 }), /noise floor/);
});
