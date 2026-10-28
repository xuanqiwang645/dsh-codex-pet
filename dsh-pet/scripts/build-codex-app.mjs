/** Build the noncommercial Codex companion from the reviewed upstream source. */
import { rolldown } from 'rolldown';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shimNames = ['dsh-home-paths', 'dsh-credentials', 'dsh-llm'];
const alias = Object.fromEntries(shimNames.map(name => [
  `@deepseek-ai/${name}`, join(root, 'src/standalone/shims', `${name}.ts`),
]));
mkdirSync(join(root, 'lib'), { recursive: true });
const bundle = await rolldown({
  input: join(root, 'src/app/main.ts'),
  platform: 'node',
  resolve: { alias },
  external: id => id === 'electron' || id.startsWith('node:') ||
    id.startsWith('@electron/') || id.startsWith('@electron-internal/') ||
    (id.startsWith('@deepseek-ai/') && !Object.hasOwn(alias, id)),
});
await bundle.write({ file: join(root, 'lib/app.js'), format: 'esm', sourcemap: true });
await bundle.close();
await import('./build-desktop-core.mjs');
console.log('Codex companion application and shared runtime built.');
