/** Keep the Codex companion's own data separate from both native Codex and DSH. */
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readUserConfig } from '../host/config.ts';
import { dragMotionValid } from '../host/config/validate.ts';

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
  const defaultDragMotion = pets[0].dragMotion;
  if (defaultDragMotion !== undefined && !dragMotionValid(defaultDragMotion)) {
    throw new Error('内置角色默认拖拽配置无效。');
  }
  const animationSource = join(source, animationName);
  assertDirectory(animationSource);
  const safeAnimationName = (name: string): boolean =>
    name.length <= 180 &&
    !name.startsWith('.') &&
    // eslint-disable-next-line no-control-regex -- Control characters cannot occur in installed filenames.
    /^[^\\/:*?"<>|\u0000-\u001f]+\.webm$/u.test(name);
  const animations = readdirSync(animationSource, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (
    !animations.length ||
    animations.some((file) => !file.isFile() || file.isSymbolicLink() || !safeAnimationName(file.name))
  ) {
    throw new Error('内置角色动画文件无效。');
  }
  const previous = manifest.previousAnimationHashes;
  if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) {
    throw new Error('内置角色旧素材清单无效。');
  }
  const animationNames = new Set(animations.map((file) => file.name));
  const previousHashes = new Map<string, string>();
  for (const [name, hash] of Object.entries(previous ?? {})) {
    if (
      !safeAnimationName(name) ||
      !animationNames.has(name) ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash)
    ) {
      throw new Error('内置角色旧素材清单无效。');
    }
    previousHashes.set(name, hash);
  }
  // Check existing destinations before copying, including files we will preserve.
  for (const dir of [dirname(destination), destination, join(destination, animationName)]) {
    if (existsSync(dir)) assertDirectory(dir);
  }
  const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  const copies = animations.map((file) => ({
    original: join(animationSource, file.name),
    target: join(destination, animationName, file.name),
    previousHash: previousHashes.get(file.name),
  }));
  // Existing configuration can only gain a missing new behavior default for this reviewed character.
  const configTarget = join(destination, configName);
  copies.push({ original: configFile, target: configTarget, previousHash: undefined });
  for (const { target } of copies) if (existsSync(target)) assertFile(target);
  mkdirSync(join(destination, animationName), { recursive: true, mode: 0o700 });
  const changes: Array<{ target: string; backup?: string }> = [];
  const temporaryFiles: string[] = [];
  const backupFiles: string[] = [];
  try {
    // Install the config last, so a failed first install never exposes a partial character.
    for (const { original, target, previousHash } of copies) {
      if (!existsSync(target)) {
        copyFileSync(original, target, constants.COPYFILE_EXCL);
        changes.push({ target });
        continue;
      }
      assertFile(target);
      let updatedConfig: string | undefined;
      if (target === configTarget) {
        if (defaultDragMotion === undefined) continue;
        const current = readUserConfig({ userFile: target, defaultFile: '', petDir: '' });
        if (!current || !Array.isArray(current.pets)) continue;
        let missing = false;
        const nextPets = current.pets.map((pet) => {
          if (!pet || typeof pet !== 'object' || pet.id !== entry || pet.dragMotion !== undefined) return pet;
          missing = true;
          return { ...pet, dragMotion: defaultDragMotion };
        });
        // Preserve custom settings, including null/unknown dragMotion values, and unreadable configs.
        if (!missing) continue;
        updatedConfig = JSON.stringify({ ...current, pets: nextPets }, null, 2) + '\n';
      } else {
        if (!previousHash) continue;
        const currentHash = hashFile(target);
        const bundledHash = hashFile(original);
        // Identical assets need no backup. An unknown hash is a user's custom animation.
        if (currentHash === bundledHash || currentHash !== previousHash) continue;
      }
      const suffix = randomUUID();
      const temporary = join(dirname(target), '.' + suffix + '.bundled-update.tmp');
      const backup = join(dirname(target), '.' + basename(target) + '.bundled-backup-' + suffix);
      copyFileSync(target, backup, constants.COPYFILE_EXCL);
      backupFiles.push(backup);
      temporaryFiles.push(temporary);
      if (updatedConfig === undefined) copyFileSync(original, temporary, constants.COPYFILE_EXCL);
      else writeFileSync(temporary, updatedConfig, { flag: 'wx', mode: lstatSync(target).mode });
      // The config uses the same byte-preserving backup and transaction as the media.
      renameSync(temporary, target);
      changes.push({ target, backup });
    }
  } catch (error) {
    const unrecovered = new Set<string>();
    let rollbackFailed = false;
    for (const change of changes.reverse()) {
      try {
        if (change.backup) renameSync(change.backup, change.target);
        else unlinkSync(change.target);
      } catch {
        rollbackFailed = true;
        if (change.backup) unrecovered.add(change.backup);
      }
    }
    for (const path of [...temporaryFiles, ...backupFiles]) {
      if (unrecovered.has(path) || !existsSync(path)) continue;
      try {
        unlinkSync(path);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed)
      throw new Error('内置角色素材更新失败，部分旧素材已保留为备份，请恢复后重试。', { cause: error });
    throw error;
  }
}
