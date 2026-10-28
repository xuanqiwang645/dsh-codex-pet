/**
 * 桌面 Helper 的组合根：把宠物列表、进程拉起、重启串行化三块拼成对外能力。
 *
 * 只做装配，不含逻辑；三块的分工见 ./desktop/ 下各自模块头。
 * 必须始终成立：requestRestart 是唯一的重启入口，内部串行且不重叠。
 * @module dsh-pet/src/host/plugin/desktop-helper
 */
import { createDesktopPets } from './desktop/pets.ts';
import { createDesktopSpawn } from './desktop/spawn.ts';
import { createDesktopSync } from './desktop/sync.ts';
import type { DesktopHelperDeps } from './desktop/types.ts';

export type { DesktopHelperDeps };

/**
 * 创建桌面 Helper 的全部能力。
 * @param deps - 装配期对象与桌面侧需要的动作函数。
 * @returns 启动、停止、请求重启与素材根解析。
 */
export function createDesktopHelper(deps: DesktopHelperDeps) {
  // DSH ctx 的未注入服务不能直接读属性；无 get 的普通上下文才回落成属性。
  const get = (deps.ctx as { get?: (name: string, required?: boolean) => unknown }).get;
  const restart =
    typeof get === 'function'
      ? get.call(deps.ctx, 'restartDesktopApp', false)
      : (deps.ctx as Record<string, unknown>).restartDesktopApp;
  const restartInProcess =
    typeof restart === 'function' ? () => (restart as () => void | Promise<void>).call(deps.ctx) : undefined;
  const pets = createDesktopPets(deps);
  const spawn = createDesktopSpawn({ ...deps, ...pets });
  const sync = createDesktopSync({ ...deps, ...pets, ...spawn, restartInProcess });
  return {
    startHelper: spawn.startHelper,
    stopHelper: spawn.stopHelper,
    requestRestart: sync.requestRestart,
    assetRootFor: spawn.assetRootFor,
    userRootFor: spawn.userRootFor,
    markDisposed: spawn.markDisposed,
  };
}

/** 桌面 Helper 生命周期的产出（供下游工厂按需 Pick）。 */
export type DesktopHelper = ReturnType<typeof createDesktopHelper>;
