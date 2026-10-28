/** Keep the Codex companion's own data separate from both native Codex and DSH. */
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { readUserConfig } from '../host/config.ts';

interface CompanionApp {
  getPath(name: string): string;
  setPath(name: string, value: string): void;
  setName(name: string): void;
}

export function configureCompanion(app: CompanionApp, packageRoot?: string): void {
  const root = join(app.getPath('appData'), 'DSH Codex Pet');
  const override = process.env.DSH_CODEX_PET_DATA;
  if (override && !isAbsolute(override)) throw new Error('DSH_CODEX_PET_DATA must be absolute');
  const data = override || join(root, 'data');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const profile = override ? join(data, 'chromium') : join(root, 'chromium');
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  app.setName('DSH Codex Pet');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  // Only the companion process sees this override; ~/.dsh and Codex stay intact.
  process.env.DSH_HOME = data;
  process.env.DSH_PET_COMPANION = '1';
  process.env.DSH_CODEX_PET_PROFILE = app.getPath('userData');
  const file = join(data, 'dsh-pet', 'main-config.jsonc');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(
      file,
      JSON.stringify(
        {
          font: { family: 'system', size: 21, followPet: true },
          pets: [
            {
              id: 'main',
              name: '鲸鱼娘',
              size: 420,
              balanceEnabled: true,
              whisperEnabled: true,
              workStatusEnabled: true,
              fixedEnabled: false,
              display: 'desktop',
              position: { corner: 'bottom-right', marginX: 40, marginY: 65 },
            },
          ],
          notificationsEnabled: false,
          voiceEnabled: false,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  }
  if (packageRoot) installBundledCharacter(packageRoot, join(data, 'dsh-pet', 'pet'));
}

/** Only this reviewed built-in pack can create files in the private pet directory. */
function installBundledCharacter(packageRoot: string, destination: string): void {
  const entry = 'chatgpt-dragon';
  const configName = entry + '-config.jsonc';
  const animationName = entry + '-animation';
  const source = join(packageRoot, 'assets', 'pet-packs', entry);
  if (!existsSync(source)) return;
  const assertDirectory = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('内置角色目录无效。');
  };
  const assertFile = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('内置角色文件无效。');
  };
  for (const dir of [join(packageRoot, 'assets'), join(packageRoot, 'assets', 'pet-packs'), source])
    assertDirectory(dir);
  const manifestFile = join(source, 'pack.json');
  assertFile(manifestFile);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  if (
    manifest.id !== entry ||
    manifest.config !== configName ||
    manifest.animationDirectory !== animationName ||
    manifest.version !== 1
  ) {
    throw new Error('内置角色清单无效。');
  }
  const configFile = join(source, configName);
  assertFile(configFile);
  const config = readUserConfig({ userFile: configFile, defaultFile: '', petDir: '' });
  const pets = config?.pets;
  if (!Array.isArray(pets) || pets.length !== 1 || !pets[0] || pets[0].id !== entry || pets[0].display !== 'none') {
    throw new Error('内置角色默认配置无效。');
  }
  const animationSource = join(source, animationName);
  assertDirectory(animationSource);
  const animations = readdirSync(animationSource, { withFileTypes: true });
  if (
    !animations.length ||
    animations.some((file) => !file.isFile() || file.isSymbolicLink() || !file.name.endsWith('.webm'))
  ) {
    throw new Error('内置角色动画文件无效。');
  }
  // Check existing destinations before copying, including files we will preserve.
  for (const dir of [dirname(destination), destination, join(destination, animationName)]) {
    if (existsSync(dir)) assertDirectory(dir);
  }
  const copies = animations.map(
    (file) => [join(animationSource, file.name), join(destination, animationName, file.name)] as const,
  );
  copies.push([configFile, join(destination, configName)]);
  for (const [, target] of copies) if (existsSync(target)) assertFile(target);
  mkdirSync(join(destination, animationName), { recursive: true, mode: 0o700 });
  const created: string[] = [];
  try {
    // Install the config last, so a failed first install never exposes a partial character.
    for (const [original, target] of copies) {
      if (existsSync(target)) continue;
      copyFileSync(original, target, constants.COPYFILE_EXCL);
      created.push(target);
    }
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(path);
    throw error;
  }
}
