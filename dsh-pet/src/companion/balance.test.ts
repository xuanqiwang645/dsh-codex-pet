import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCodexQuota, quotaBalance, registerCodexBalance } from './balance.ts';
import { queryBalance } from '../host/balance/index.ts';
import { toBalanceState } from '../shared/balance/parse.ts';

const fixture = {
  rateLimits: { limitId: 'legacy', primary: { usedPercent: 99, windowDurationMins: 60 } },
  rateLimitsByLimitId: {
    codex: {
      limitName: 'Codex',
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1793260800 },
      secondary: { usedPercent: 42.5, windowDurationMins: 10080, resetsAt: 1793347200 },
    },
    extra: {
      limitName: 'Extended',
      primary: { usedPercent: 81, windowDurationMins: 60 },
      secondary: { usedPercent: null, windowDurationMins: 1440, resetsAt: null },
    },
  },
};

test('Codex quota keeps all multi-bucket windows and computes remaining from used', () => {
  const result = normalizeCodexQuota(fixture, 100);
  assert.equal(result.checkedAt, 100);
  assert.equal(result.buckets.length, 2);
  assert.deepEqual(
    result.buckets.map((bucket) => bucket.windows.length),
    [2, 2],
  );
  assert.equal(result.buckets[0].windows[0].remainingPercent, 75);
  assert.equal(result.buckets[0].windows[0].label, '5 小时窗口');
  assert.equal(result.buckets[0].windows[1].remainingPercent, 57.5);
  assert.equal(result.buckets[0].windows[1].label, '7 天窗口');
  assert.equal(result.buckets[0].windows[1].resetsAt, 1793347200);
  assert.equal(result.buckets[1].windows[1].remainingPercent, null);
});

test('legacy fallback, missing fields and invalid percentages never invent zero usage', () => {
  const result = normalizeCodexQuota({
    rateLimitsByLimitId: {},
    rateLimits: { primary: { usedPercent: '2' }, secondary: { usedPercent: 120, resetsAt: Infinity } },
  });
  assert.equal(result.buckets[0].windows[0].usedPercent, null);
  assert.equal(result.buckets[0].windows[0].remainingPercent, null);
  assert.equal(result.buckets[0].windows[1].usedPercent, 100);
  assert.equal(result.buckets[0].windows[1].remainingPercent, 0);
  assert.equal(result.buckets[0].windows[1].resetsAt, null);
  assert.throws(() => normalizeCodexQuota({ rateLimits: null }), /没有可用/);
  assert.throws(() => normalizeCodexQuota(null), /暂未返回/);
});

test('quota bubble uses real maximum usage, shows urgent window first, and passes shared parser', () => {
  const balance = quotaBalance(normalizeCodexQuota(fixture));
  assert.equal(balance.shape, 'custom');
  if (balance.shape !== 'custom') throw new Error('Wrong balance shape');
  assert.equal(balance.data.percent, 81);
  assert.match(JSON.stringify(balance.data.views?.[0]), /Extended/);
  assert.match(JSON.stringify(balance.data.views?.[0]), /剩余 19%/);
  const parsed = toBalanceState(balance);
  assert.ok(parsed);
  assert.equal(parsed.ok, true);
});

test('large quota lists keep all windows in normalized response and bound bubble capacity', () => {
  const buckets = Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => [
      `bucket-${index}`,
      { primary: { usedPercent: index, windowDurationMins: 60 } },
    ]),
  );
  const snapshot = normalizeCodexQuota({ rateLimitsByLimitId: buckets });
  assert.equal(snapshot.buckets.length, 15);
  const result = quotaBalance(snapshot);
  assert.equal(result.shape, 'custom');
  if (result.shape !== 'custom') throw new Error('Wrong balance shape');
  assert.equal(result.data.views?.length, 4);
  assert.match(JSON.stringify(result.data.views), /完整额度见/);
  assert.ok(toBalanceState(result));
});

test('registered Codex balance avoids credentials and unregisters cleanly', async () => {
  let calls = 0;
  const dispose = registerCodexBalance(async () => {
    calls++;
    return fixture;
  });
  try {
    const result = await queryBalance('codex', async () => {
      throw new Error('Must not resolve API credentials');
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'codex');
    assert.equal(calls, 1);
  } finally {
    dispose();
  }
  assert.deepEqual(await queryBalance('codex', async () => undefined), {
    ok: false,
    provider: 'codex',
    reason: 'unsupported',
  });
});
