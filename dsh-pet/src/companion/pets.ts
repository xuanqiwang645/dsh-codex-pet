/** Select one desktop character without losing another character's settings or memory. */
import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  isValidPetId,
  readAllConfig,
  readPetConfigEntry,
  readUserConfig,
  saveUserConfig,
  type ConfigPaths,
} from '../host/config.ts';
import { runConfigOperation } from '../host/config/queue.ts';
import { readBody } from '../host/http.ts';
import type { RegisteredRoute } from '../standalone/context.ts';

interface SelectionResult {
  selectedId: string;
  changed: boolean;
}
interface PetSelectionDeps {
  configPaths: ConfigPaths;
  restart(): void;
  /** Filesystem move primitive, injectable for rollback verification. */
  moveFile?: typeof renameSync;
}
class SelectionError extends Error {}
class SelectionRecoveryError extends Error {}

function regularFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid configuration file');
}

/** Stage every replacement first, then commit once; restore exact prior bytes on failure. */
function selectPet(deps: PetSelectionDeps, id: string): SelectionResult {
  const merged = readAllConfig(deps.configPaths);
  if (!Object.values(merged).some((conf) => Array.isArray(conf.pets) && conf.pets.some((pet) => pet.id === id))) {
    throw new SelectionError('这只角色已不存在，请刷新角色列表。');
  }
  const plans: Array<{ path: string; content: string; staged: string; backup?: string; committed: boolean }> = [];
  const move = deps.moveFile ?? renameSync;
  const transactionId = process.pid + '.' + randomUUID();
  for (const [entry, conf] of Object.entries(merged)) {
    const current = Array.isArray(conf.pets) ? (conf.pets as Array<Record<string, unknown>>) : [];
    const pets = current.map((pet) => ({ ...pet, display: pet.id === id ? 'desktop' : 'none' }));
    if (pets.every((pet, index) => pet.display === current[index].display)) continue;
    let path: string;
    let existing: Record<string, unknown> | undefined;
    if (entry === 'main') {
      path = deps.configPaths.userFile;
      if (existsSync(path)) regularFile(path);
      existing = readUserConfig(deps.configPaths);
      if (existsSync(path) && !existing) throw new Error('Cannot parse existing configuration');
    } else {
      const layer = readPetConfigEntry(deps.configPaths, entry);
      if (!layer || !layer.raw) throw new Error('Cannot read character configuration');
      path = layer.path;
      regularFile(path);
      existing = layer.raw;
    }
    const dir = dirname(path);
    if (existsSync(dir)) {
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid configuration directory');
    }
    const clean = saveUserConfig({ pets }, existing);
    if (!clean) throw new Error('Cannot save character configuration');
    // Retain hand-edited per-instance metadata as well as top-level advanced settings.
    const originals = new Map((Array.isArray(existing?.pets) ? existing.pets : []).map((pet) => [pet.id, pet]));
    clean.pets = (clean.pets as Array<Record<string, unknown>>).map((pet) => ({ ...originals.get(pet.id), ...pet }));
    plans.push({
      path,
      content: JSON.stringify(clean, null, 2) + '\n',
      staged: path + '.pet-select.' + transactionId,
      committed: false,
    });
  }
  if (!plans.length) return { selectedId: id, changed: false };
  let keepBackups = false;
  try {
    for (const plan of plans) {
      mkdirSync(dirname(plan.path), { recursive: true, mode: 0o700 });
      const mode = existsSync(plan.path) ? lstatSync(plan.path).mode & 0o777 : 0o600;
      writeFileSync(plan.staged, plan.content, { flag: 'wx', mode });
      if (existsSync(plan.path)) {
        plan.backup = plan.path + '.pet-select-backup.' + transactionId;
        copyFileSync(plan.path, plan.backup, constants.COPYFILE_EXCL);
      }
    }
    for (const plan of plans) {
      move(plan.staged, plan.path);
      plan.committed = true;
    }
  } catch (error) {
    for (const plan of plans.slice().reverse()) {
      if (!plan.committed) continue;
      try {
        if (plan.backup) move(plan.backup, plan.path);
        else unlinkSync(plan.path);
      } catch {
        keepBackups = true;
      }
    }
    if (keepBackups) throw new SelectionRecoveryError('角色切换中断，原配置备份已保留，请先恢复备份。');
    throw error;
  } finally {
    for (const plan of plans) {
      for (const file of [plan.staged, ...(keepBackups ? [] : [plan.backup])])
        if (file && existsSync(file)) unlinkSync(file);
    }
  }
  return { selectedId: id, changed: true };
}

export function createCompanionPetsRoute(deps: PetSelectionDeps): RegisteredRoute {
  return {
    kind: 'exact',
    path: '/companion/pets/select',
    async handler(req, res) {
      const send = (status: number, value: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      if (req.method !== 'POST') {
        send(405, { ok: false, message: '仅支持 POST' });
        return;
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        send(415, { ok: false, message: '请使用 JSON 选择角色。' });
        return;
      }
      let id: string;
      try {
        const parsed: unknown = JSON.parse(await readBody(req));
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Object.keys(parsed).some((key) => key !== 'id')
        )
          throw new Error();
        const value = (parsed as { id?: unknown }).id;
        if (typeof value !== 'string' || !isValidPetId(value.trim())) throw new Error();
        id = value.trim();
      } catch {
        send(400, { ok: false, message: '角色选择无效，请刷新列表后重试。' });
        return;
      }
      let result: SelectionResult;
      try {
        result = await runConfigOperation(deps.configPaths, () => selectPet(deps, id));
      } catch (error) {
        send(error instanceof SelectionError ? 400 : 500, {
          ok: false,
          message:
            error instanceof SelectionError || error instanceof SelectionRecoveryError
              ? error.message
              : '角色切换未完成，原配置已保留，请重试。',
        });
        return;
      }
      send(200, {
        ok: true,
        selectedId: result.selectedId,
        message: result.changed ? '已选择角色，桌宠正在重启。' : '当前角色已在桌面显示。',
      });
      if (result.changed) deps.restart();
    },
  };
}
