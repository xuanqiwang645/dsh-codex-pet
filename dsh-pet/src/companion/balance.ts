/** Codex quota adapter: real account limits, never a fabricated currency balance. */
import { registerBalanceProvider } from '../host/balance/registry.ts';
import type { BalanceSuccess, CustomNode, PluginProvider } from '../host/balance/types.ts';
import type { RegisteredRoute } from '../standalone/context.ts';

export type ReadRateLimits = () => Promise<unknown>;
export interface CodexQuotaWindow {
  key: 'primary' | 'secondary';
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: number | null;
}
export interface CodexQuotaBucket {
  id: string;
  label: string;
  windows: CodexQuotaWindow[];
}
export interface CodexQuotaSnapshot {
  buckets: CodexQuotaBucket[];
  checkedAt: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function windowLabel(minutes: unknown, key: 'primary' | 'secondary'): string {
  const duration = number(minutes);
  if (duration === null || duration <= 0) return key === 'primary' ? '主要窗口' : '次要窗口';
  if (duration % 1440 === 0) return `${duration / 1440} 天窗口`;
  if (duration % 60 === 0) return `${duration / 60} 小时窗口`;
  return `${duration} 分钟窗口`;
}

/** Prefer the multi-bucket response; null and malformed percentages remain unavailable. */
export function normalizeCodexQuota(input: unknown, now = Date.now()): CodexQuotaSnapshot {
  const root = record(input);
  if (!root) throw new Error('Codex 暂未返回额度数据，请检查登录状态后重试');
  const multi = record(root.rateLimitsByLimitId);
  const entries = multi ? Object.entries(multi).filter(([, value]) => record(value)) : [];
  const fallback = record(root.rateLimits);
  const sources: Array<[string, unknown]> = entries.length
    ? entries
    : fallback
      ? [[typeof fallback.limitId === 'string' ? fallback.limitId : 'codex', fallback]]
      : [];
  if (!sources.length) throw new Error('当前账号没有可用的 Codex 额度数据');
  const buckets = sources.map(([id, value]): CodexQuotaBucket => {
    const source = record(value)!;
    const windows: CodexQuotaWindow[] = [];
    for (const key of ['primary', 'secondary'] as const) {
      const window = record(source[key]);
      if (!window) continue;
      const rawUsed = number(window.usedPercent);
      const used = rawUsed === null ? null : Math.max(0, Math.min(100, rawUsed));
      const rawReset = number(window.resetsAt);
      windows.push({
        key,
        label: windowLabel(window.windowDurationMins, key),
        usedPercent: used,
        remainingPercent: used === null ? null : Math.round((100 - used) * 10) / 10,
        resetsAt: rawReset !== null && rawReset > 0 && rawReset <= 8.64e12 ? rawReset : null,
      });
    }
    const label =
      typeof source.limitName === 'string' && source.limitName.trim()
        ? source.limitName.trim().slice(0, 80)
        : id.slice(0, 80);
    return { id, label, windows };
  });
  return { buckets, checkedAt: now };
}

function resetLabel(seconds: number | null): string {
  if (seconds === null) return '重置时间未提供';
  return `重置 ${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(seconds * 1000))}`;
}

function textNode(text: string, bold = false): CustomNode {
  return { tag: 'div', text, style: { fontSize: '12px', ...(bold ? { fontWeight: '700' } : {}) } };
}

/** Keep the most urgent limit visible first; all windows remain available in settings. */
export function quotaBalance(snapshot: CodexQuotaSnapshot): BalanceSuccess {
  const entries: Array<{ node: CustomNode; used: number | null }> = [];
  const knownUsed: number[] = [];
  for (const bucket of snapshot.buckets) {
    if (!bucket.windows.length) {
      entries.push({ node: textNode(`${bucket.label}：窗口数据未提供`), used: null });
      continue;
    }
    for (const window of bucket.windows) {
      if (window.usedPercent !== null) knownUsed.push(window.usedPercent);
      entries.push({
        used: window.usedPercent,
        node: {
          tag: 'div',
          style: { marginBottom: '5px' },
          children: [
            textNode(`${bucket.label} · ${window.label}`, true),
            textNode(window.remainingPercent === null ? '剩余额度暂不可用' : `剩余 ${window.remainingPercent}%`),
            { tag: 'div', text: resetLabel(window.resetsAt), style: { fontSize: '10px', opacity: '.75' } },
          ],
        },
      });
    }
  }
  const pages: CustomNode[] = [];
  const rows = entries.sort((a, b) => (b.used ?? -1) - (a.used ?? -1)).map((entry) => entry.node);
  const visible = rows.slice(0, 8);
  for (let i = 0; i < visible.length; i += 2) {
    pages.push({
      tag: 'div',
      children: [
        textNode('Codex 可用额度', true),
        ...visible.slice(i, i + 2),
        {
          tag: 'div',
          text: rows.length > 8 ? '完整额度见「桌宠设置」' : '套餐额度，非 API 现金余额',
          style: { fontSize: '10px', opacity: '.7' },
        },
      ],
    });
  }
  if (!pages.length) pages.push({ tag: 'div', children: [textNode('Codex 暂未提供额度窗口')] });
  return {
    ok: true,
    provider: 'codex',
    shape: 'custom',
    data: {
      views: pages,
      ...(knownUsed.length ? { percent: Math.max(...knownUsed) } : {}),
    },
  };
}

/** Install into the upstream extension registry before applying the host plugin. */
export function registerCodexBalance(readRateLimits: ReadRateLimits): () => void {
  const provider: PluginProvider = {
    id: 'codex',
    fetch: async () => quotaBalance(normalizeCodexQuota(await readRateLimits())),
  };
  return registerBalanceProvider(provider);
}

/** Authenticated by the application's normal router; no account identifiers or tokens returned. */
export function createCodexQuotaRoute(readRateLimits: ReadRateLimits): RegisteredRoute {
  return {
    kind: 'exact',
    path: '/companion/quota',
    async handler(req, res) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end(JSON.stringify({ ok: false, message: '仅支持 GET' }));
        return;
      }
      try {
        const snapshot = normalizeCodexQuota(await readRateLimits());
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...snapshot }));
      } catch {
        res.writeHead(503);
        res.end(JSON.stringify({ ok: false, message: '暂时无法读取 Codex 额度，请在 Codex 中确认登录后重试' }));
      }
    },
  };
}
