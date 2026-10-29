/**
 * 跟手弹簧与限速：把指针位移变成平滑的跟手速度。
 *
 * 不读时钟、不写状态；dt 由调用方按帧传入。
 * 必须始终成立：dt 需小于 MAX_STEP_DT，否则阶跃过大。
 * @module dsh-pet/src/shared/physics/spring
 */
import { DEFAULT_THROW_POWER, MAX_THROW_SPEED, SPRING_C, SPRING_K } from './constants.ts';

/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。
 *  power = 总力度（K/C 同乘：系统形态不变，收敛速度快 p 倍，即更跟手或更松）。 */
export const springStep = (
  v: number,
  x: number,
  target: number,
  dt: number,
  power: number = DEFAULT_THROW_POWER,
): number => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

/**
 * 稳定拖拽的单轴临界阻尼解析解。保留小数位置，避免窗口取整值反馈造成停滞/抖动。
 * 指针反向时先清掉背离目标的惯性，并将结果约束在当前位置与目标之间；停手后不会回摆。
 * responseMs 独立于 throwPower，改抛掷力度不会把跟随变成欠阻尼。
 */
export function stableDragStep(
  v: number,
  x: number,
  target: number,
  dt: number,
  responseMs = 100,
): { x: number; v: number } {
  if (!(dt > 0)) return { x, v };
  const distance = target - x;
  if (distance === 0) return { x: target, v: 0 };
  const response = Number.isFinite(responseMs) ? Math.min(500, Math.max(40, responseMs)) : 100;
  const omega = 2000 / response;
  const speed = v * distance < 0 ? 0 : v;
  const offset = x - target;
  const sum = speed + omega * offset;
  const decay = Math.exp(-omega * dt);
  const next = target + (offset + sum * dt) * decay;
  const position = Math.min(Math.max(next, Math.min(x, target)), Math.max(x, target));
  return { x: position, v: position === target ? 0 : (speed - omega * sum * dt) * decay };
}

/** 软钳速：cap×(1-e^(-s/cap))，任意速度下单调可区分、渐近不超过 cap。
 *  抛掷指令与拖拽甩抛走同一条限速，手感一致。 */
export const softClampSpeed = (speed: number): number => {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
