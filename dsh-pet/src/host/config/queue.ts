/** One write/read queue per user configuration, shared by host and companion routes. */
import { resolve } from 'node:path';
import type { ConfigPaths } from './constants.ts';

const queues = new Map<string, Promise<void>>();

export function runConfigOperation<T>(
  paths: Pick<ConfigPaths, 'userFile'>,
  operation: () => T | Promise<T>,
): Promise<T> {
  const key = resolve(paths.userFile);
  const current = queues.get(key) ?? Promise.resolve();
  const pending = current.then(operation, operation);
  const tail = pending.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return pending;
}
