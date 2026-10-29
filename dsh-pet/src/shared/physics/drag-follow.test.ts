import assert from 'node:assert/strict';
import test from 'node:test';
import { stableDragStep } from './spring.ts';

test('stable drag approaches the pointer without overshooting at 30, 60 or 144 Hz', () => {
  for (const fps of [30, 60, 144]) {
    for (const target of [-180, 0.25, 180]) {
      let x = 0;
      let v = 0;
      for (let frame = 0; frame < fps; frame++) {
        const next = stableDragStep(v, x, target, 1 / fps);
        assert.ok(next.x >= Math.min(x, target) && next.x <= Math.max(x, target));
        x = next.x;
        v = next.v;
      }
      assert.ok(Math.abs(x - target) < 0.001, 'even subpixel movement must reach the pointer');
    }
  }
});

test('a sudden direction change brakes the old velocity immediately and never swings away from the pointer', () => {
  let { x, v } = stableDragStep(0, 0, 200, 0.1);
  assert.ok(x > 0 && v > 0);
  for (let frame = 0; frame < 80; frame++) {
    const next = stableDragStep(v, x, -40, 1 / 60);
    assert.ok(next.x <= x && next.x >= -40);
    x = next.x;
    v = next.v;
  }
  assert.ok(Math.abs(x + 40) < 0.001);
});

test('the analytic follow stays bounded after a delayed frame and is consistent across frame rates', () => {
  const delayed = stableDragStep(500, 0, 1, 1);
  assert.ok(delayed.x >= 0 && delayed.x <= 1);
  const one = stableDragStep(0, 0, 100, 1 / 30);
  const half = stableDragStep(0, 0, 100, 1 / 60);
  const two = stableDragStep(half.v, half.x, 100, 1 / 60);
  assert.ok(Math.abs(one.x - two.x) < 1e-10);
  assert.ok(Math.abs(one.v - two.v) < 1e-10);
});
