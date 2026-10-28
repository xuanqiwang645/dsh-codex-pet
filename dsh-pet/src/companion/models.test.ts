import assert from 'node:assert/strict';
import test from 'node:test';
import { startRouter } from '../app/router.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { createCodexModelsRoute } from './models.ts';

test('model catalog requires the existing capability and publishes only model-picker metadata', async () => {
  let calls = 0;
  const security = createRequestSecurity();
  const server = await startRouter(
    [
      createCodexModelsRoute(async () => {
        calls++;
        return {
          connected: true,
          configuredModel: 'second',
          effectiveModel: 'second',
          models: [
            { id: 'first', name: 'First', isDefault: true },
            { id: 'second', name: 'Second', isDefault: false },
          ],
          privateAccount: 'must-not-leak',
        };
      }),
    ],
    { security, log() {}, status: () => ({}), landingPage: () => '' },
  );
  const url = `http://127.0.0.1:${server.port}/companion/models`;
  const headers = { 'X-DSH-Pet-Token': security.token };
  try {
    const denied = await fetch(url);
    assert.equal(denied.status, 403);
    await denied.text();
    assert.equal(calls, 0);
    const wrongMethod = await fetch(url, { method: 'POST', headers });
    assert.equal(wrongMethod.status, 405);
    await wrongMethod.text();
    assert.equal(calls, 0);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      ok: true,
      connected: true,
      configuredModel: 'second',
      effectiveModel: 'second',
      models: [
        { id: 'first', name: 'First', isDefault: true },
        { id: 'second', name: 'Second', isDefault: false },
      ],
    });
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test('catalog failures return an actionable message without exposing underlying process errors', async () => {
  const security = createRequestSecurity();
  const server = await startRouter(
    [
      createCodexModelsRoute(async () => {
        throw new Error('private account secret');
      }),
    ],
    { security, log() {}, status: () => ({}), landingPage: () => '' },
  );
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/companion/models`, {
      headers: { 'X-DSH-Pet-Token': security.token },
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.doesNotMatch(body, /private account secret/);
    assert.match(body, /Codex 登录后重试/);
  } finally {
    await server.close();
  }
});
