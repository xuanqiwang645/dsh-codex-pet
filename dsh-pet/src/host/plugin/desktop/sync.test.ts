import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDesktopSync } from './sync.ts';
import { createDesktopHelper, type DesktopHelperDeps } from '../desktop-helper.ts';
import type { FileLogger } from '../../log-file.ts';

function logger(warnings: string[] = []): FileLogger {
  return {
    file: '/unused-test-log',
    isFileLogger: true,
    info() {},
    error() {},
    debug() {},
    warn(message) {
      warnings.push(message);
    },
    async flush() {},
    dispose() {},
  };
}

test('in-process restart invokes only the supplied App callback, never child stop/start', async () => {
  const calls: string[] = [];
  const sync = createDesktopSync({
    log: logger(),
    logDesktopDecision: () => calls.push('decision'),
    stopHelperAndWait: async () => {
      calls.push('stop-child');
    },
    startHelper: () => calls.push('start-child'),
    restartInProcess: () => {
      calls.push('relaunch-app');
    },
  });
  await sync.requestRestart();
  assert.deepEqual(calls, ['decision', 'relaunch-app']);
});

test('ordinary helper restarts retain stop-before-start ordering and serialize requests', async () => {
  const calls: string[] = [];
  const sync = createDesktopSync({
    log: logger(),
    logDesktopDecision: () => calls.push('decision'),
    stopHelperAndWait: async (reason) => {
      calls.push(`stop:${reason}`);
      await Promise.resolve();
      calls.push('stopped');
    },
    startHelper: () => calls.push('start'),
  });
  await Promise.all([sync.requestRestart(), sync.requestRestart()]);
  assert.deepEqual(calls, [
    'decision',
    'stop:desktop-config-change',
    'stopped',
    'start',
    'decision',
    'stop:desktop-config-change',
    'stopped',
    'start',
  ]);
});

test('async App restarts remain serialized and errors do not fall back to spawning children', async () => {
  const calls: string[] = [];
  const warnings: string[] = [];
  let count = 0;
  const sync = createDesktopSync({
    log: logger(warnings),
    logDesktopDecision: () => calls.push('decision'),
    stopHelperAndWait: async () => {
      calls.push('stop-child');
    },
    startHelper: () => calls.push('start-child'),
    restartInProcess: async () => {
      const current = ++count;
      calls.push(`app:${current}`);
      await Promise.resolve();
      if (current === 1) throw new Error('retryable test error');
      calls.push(`done:${current}`);
    },
  });
  await Promise.all([sync.requestRestart(), sync.requestRestart()]);
  assert.deepEqual(calls, ['decision', 'app:1', 'decision', 'app:2', 'done:2']);
  assert.equal(warnings.length, 1);
});

function helperDeps(ctx: unknown): DesktopHelperDeps {
  return {
    ctx,
    log: logger(),
    thumbUserRoot: '/unused-test-assets',
    configPaths: {
      defaultFile: '/__dsh-test-nonexistent__/default.json',
      userFile: '/__dsh-test-nonexistent__/user.json',
      petDir: '/__dsh-test-nonexistent__/pets',
    },
    effectivePetList: () => [],
    reportDownload() {},
    getHandlePetRoute: () => async () => ({ kind: 'none' }),
  };
}

test('helper composition soft-gets the optional App restart service without strict property access', async () => {
  let restarted = 0;
  const lookup: Array<[string, boolean | undefined]> = [];
  const ctx = {
    get(name: string, required?: boolean) {
      lookup.push([name, required]);
      assert.equal(this, ctx);
      return name === 'restartDesktopApp'
        ? () => {
            restarted += 1;
          }
        : undefined;
    },
  };
  Object.defineProperty(ctx, 'restartDesktopApp', {
    get() {
      throw new Error('strict service getter');
    },
  });
  const helper = createDesktopHelper(helperDeps(ctx));
  await helper.requestRestart();
  assert.equal(restarted, 1);
  assert.deepEqual(lookup, [['restartDesktopApp', false]]);
});

test('plain standalone context can provide its own App restart callback', async () => {
  let restarted = 0;
  const ctx = {
    restartDesktopApp() {
      assert.equal(this, ctx);
      restarted += 1;
    },
  };
  const helper = createDesktopHelper(helperDeps(ctx));
  await helper.requestRestart();
  assert.equal(restarted, 1);
});
