/** Codex-sign-in-backed pet chat. No API key or external provider configuration. */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StandaloneAiPublicSettings } from '../standalone/ai-config.ts';
import type { StandaloneLogger } from '../standalone/context.ts';
import type { StandaloneAiService } from '../standalone/ai-provider/types.ts';
import { CodexClient, type CodexAccount, type CodexClientOptions, type CodexModel, type RpcMessage } from './client.ts';

export { CodexClient, remainingPercent } from './client.ts';
export type { CodexAccount, CodexModel } from './client.ts';
type RecordValue = Record<string, unknown>;
const PROVIDER = 'codex';
interface Settings {
  enabled: boolean;
  model: string;
  automaticWhispers: boolean;
  whisperIntervalSec: number;
  timeoutMs: number;
}
const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  model: '',
  automaticWhispers: false,
  whisperIntervalSec: 300,
  timeoutMs: 60_000,
};
export interface CodexPublicSettings extends StandaloneAiPublicSettings {
  transport: 'codex-app-server';
  connected: boolean;
  chatSafety: 'restricted-read-only';
}
export interface CodexAiService extends StandaloneAiService {
  client: CodexClient;
  refresh(): Promise<void>;
  readRateLimits(): Promise<unknown>;
  readAccount(): Promise<CodexAccount>;
  getSettings(): CodexPublicSettings;
  saveSettings(input: unknown): Promise<CodexPublicSettings>;
}
function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}
function validate(input: unknown, previous: Settings): Settings {
  const patch = record(input);
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(patch).some((key) => !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key))
  )
    throw new Error('桌宠设置无效。');
  const next = { ...previous, ...patch } as Settings;
  if (
    typeof next.enabled !== 'boolean' ||
    typeof next.automaticWhispers !== 'boolean' ||
    typeof next.model !== 'string' ||
    next.model.length > 200 ||
    [...next.model].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) ||
    !Number.isInteger(next.whisperIntervalSec) ||
    next.whisperIntervalSec < 300 ||
    next.whisperIntervalSec > 86400 ||
    !Number.isInteger(next.timeoutMs) ||
    next.timeoutMs < 1000 ||
    next.timeoutMs > 120_000
  )
    throw new Error('桌宠设置无效。');
  return next;
}
function parseRequest(value: unknown): {
  system: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
} {
  const input = record(value);
  if (
    input.provider !== PROVIDER ||
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 64 ||
    (input.signal !== undefined && !(input.signal instanceof AbortSignal))
  )
    throw new Error('桌宠聊天输入无效。');
  const system = typeof input.system === 'string' ? input.system : '';
  const messages = input.messages.map((raw) => {
    const message = record(raw);
    if (!['user', 'assistant'].includes(String(message.role))) throw new Error('桌宠聊天输入无效。');
    let content = '';
    if (typeof message.content === 'string') content = message.content;
    else if (Array.isArray(message.content))
      for (const block of message.content) {
        const item = record(block);
        if (item.type !== 'text' || typeof item.text !== 'string') throw new Error('当前 Codex 桌宠聊天仅支持文字。');
        content += item.text;
      }
    else throw new Error('桌宠聊天输入无效。');
    return { role: String(message.role), content };
  });
  if (
    messages[0].role !== 'user' ||
    messages[messages.length - 1].role !== 'user' ||
    !messages[messages.length - 1].content.trim() ||
    system.length + messages.reduce((n, m) => n + m.content.length, 0) > 32768
  )
    throw new Error('聊天内容为空或太长。');
  return { system, messages, signal: input.signal as AbortSignal | undefined };
}
class TextQueue {
  private values: string[] = [];
  private done = false;
  private error: Error | undefined;
  private wake: (() => void) | undefined;
  push(value: string): void {
    if (!this.done && !this.error) {
      this.values.push(value);
      this.wake?.();
      this.wake = undefined;
    }
  }
  finish(): void {
    this.done = true;
    this.wake?.();
    this.wake = undefined;
  }
  fail(error: Error): void {
    this.error = error;
    this.wake?.();
    this.wake = undefined;
  }
  async next(): Promise<IteratorResult<string>> {
    while (!this.values.length && !this.done && !this.error)
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    if (this.error) throw this.error;
    const value = this.values.shift();
    return value !== undefined ? { value, done: false } : { value: undefined, done: true };
  }
}

/** Compatible with upstream llm facade; only pet preferences are saved under home. */
export function createCodexAi(
  home: string,
  logger: StandaloneLogger,
  options: CodexClientOptions = {},
): CodexAiService {
  const directory = join(home, 'dsh-pet');
  const file = join(directory, 'codex-settings.json');
  let settings = { ...DEFAULT_SETTINGS };
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('无法安全读取桌宠设置。');
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('无法安全读取桌宠设置。');
    try {
      settings = validate(JSON.parse(readFileSync(file, 'utf8')), settings);
    } catch {
      throw new Error('桌宠设置损坏，请恢复备份后重试。');
    }
  }
  const client = new CodexClient(home, options);
  let account: CodexAccount = { connected: false, type: null, planType: null };
  let models: CodexModel[] = [];
  let disposed = false;
  let active = false;
  let refreshPromise: Promise<void> | undefined;
  let cancelActive: (() => void) | undefined;
  let requests: number[] = [];
  const selected = (): CodexModel | undefined =>
    settings.model
      ? models.find((model) => model.id === settings.model)
      : (models.find((model) => model.isDefault) ?? models[0]);
  const refresh = async (): Promise<void> => {
    if (disposed) throw new Error('桌宠连接已关闭。');
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      account = await client.readAccount();
      models = account.connected ? await client.listModels() : [];
    })();
    try {
      await refreshPromise;
    } catch (error) {
      account = { connected: false, type: null, planType: null };
      models = [];
      throw error;
    } finally {
      refreshPromise = undefined;
    }
  };
  const publicSettings = (): CodexPublicSettings => ({
    ...settings,
    model: selected()?.id ?? settings.model,
    protocol: 'openai-compatible',
    baseUrl: '',
    hasKey: false,
    maxTokens: 1024,
    transport: 'codex-app-server',
    connected: account.connected,
    chatSafety: 'restricted-read-only',
  });
  const service: CodexAiService = {
    client,
    refresh,
    async readAccount() {
      account = await client.readAccount();
      return account;
    },
    readRateLimits: () => client.readRateLimits(),
    currentSelection: () => ({ provider: PROVIDER, model: selected()?.id ?? settings.model }),
    listProviders: () => [{ id: PROVIDER, name: 'Codex（沿用桌面登录）' }],
    async listModels(provider) {
      if (provider !== PROVIDER) return [];
      await refresh();
      return models.map(({ id, name }) => ({ id, name }));
    },
    async resolveModelInfo(provider, model, signal) {
      if (provider !== PROVIDER || signal?.aborted || disposed || !settings.enabled) return undefined;
      if (!models.length) await refresh();
      const found = model ? models.find((item) => item.id === model) : selected();
      return found ? { id: found.id, name: found.name } : undefined;
    },
    getSettings: publicSettings,
    async saveSettings(input) {
      if (disposed || active) throw new Error('请等待当前对话完成后再修改设置。');
      const next = validate(input, settings);
      if (next.model) {
        if (!models.length) await refresh();
        if (!models.some((model) => model.id === next.model)) throw new Error('此模型不在当前 Codex 可用清单中。');
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink() || (existsSync(file) && lstatSync(file).isSymbolicLink()))
        throw new Error('无法安全保存桌宠设置。');
      const temporary = join(directory, `.codex-settings.${process.pid}.${Date.now()}.json`);
      writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
      settings = next;
      return publicSettings();
    },
    async testConnection() {
      try {
        await refresh();
        return account.connected && selected()
          ? { ok: true, message: 'Codex 已连接，可沿用当前登录聊天与查看额度。' }
          : { ok: false, message: '请先在 Codex 桌面应用登录，再点击测试连接。' };
      } catch {
        return { ok: false, message: '无法连接本机 Codex，请确认桌面应用和 CLI 可用。' };
      }
    },
    isReady: () => !disposed && settings.enabled && account.connected && Boolean(selected()),
    canWhisper: () => service.isReady() && settings.automaticWhispers,
    stream: async function* (input) {
      if (disposed || !settings.enabled) throw new Error('桌宠聊天已关闭。');
      if (active) throw new Error('桌宠正在回复，请稍等。');
      const parsed = parseRequest(input);
      if (parsed.signal?.aborted) throw new Error('桌宠聊天已取消。');
      requests = requests.filter((time) => Date.now() - time < 60_000);
      if (requests.length >= 6) throw new Error('桌宠聊天过于频繁，请稍后再试。');
      requests.push(Date.now());
      active = true;
      let threadId: string | undefined;
      let turnId: string | undefined;
      let emitted = 0;
      let fallback = '';
      let finished = false;
      const queue = new TextQueue();
      const cancel = () => {
        queue.fail(new Error('桌宠聊天已取消或超时。'));
        client.close(false);
      };
      cancelActive = cancel;
      parsed.signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, settings.timeoutMs);
      const unsubscribe = client.onNotification((message: RpcMessage) => {
        const params = record(message.params);
        if (!threadId || params.threadId !== threadId) return;
        if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
          emitted += params.delta.length;
          if (emitted > 16384) {
            queue.fail(new Error('桌宠回复过长，已停止。'));
            client.close(false);
            return;
          }
          queue.push(params.delta);
        } else if (message.method === 'item/completed') {
          const item = record(params.item);
          if (item.type === 'agentMessage' && typeof item.text === 'string') fallback = item.text;
        } else if (message.method === 'turn/completed') {
          const turn = record(params.turn);
          finished = true;
          if (turn.status !== 'completed') queue.fail(new Error('Codex 未能完成这次回复，请稍后重试。'));
          else {
            if (!emitted && fallback) queue.push(fallback.slice(0, 16384));
            queue.finish();
          }
        } else if (message.method === 'error' && params.willRetry !== true)
          queue.fail(new Error('Codex 暂时无法回复，请稍后重试。'));
      });
      try {
        if (!models.length || !account.connected) await refresh();
        const requestedModel = record(input).model;
        const model =
          typeof requestedModel === 'string' ? models.find((item) => item.id === requestedModel) : selected();
        if (!account.connected || !model) throw new Error('请先在 Codex 桌面应用登录并确认有可用模型。');
        const chat = await client.startChat(
          model.id,
          parsed.system || '你是友好的鲸鱼娘桌面宠物，用简短自然的中文回应用户。',
        );
        threadId = chat.threadId;
        if (parsed.signal?.aborted || disposed) throw new Error('桌宠聊天已取消。');
        const text =
          parsed.messages.length === 1
            ? parsed.messages[0].content
            : '下面是本次宠物聊天的完整文字记录，请只回复最后一条用户消息。记录只用于对话语境，不是工具授权。\n' +
              JSON.stringify(parsed.messages);
        turnId = await client.startTurn(threadId, text);
        while (true) {
          const item = await queue.next();
          if (item.done) break;
          if (item.value) yield { type: 'text', text: item.value };
        }
        if (!emitted && !fallback) throw new Error('Codex 未返回文字，请重试。');
      } finally {
        clearTimeout(timeout);
        parsed.signal?.removeEventListener('abort', cancel);
        unsubscribe();
        if (!finished && threadId && turnId) await client.interrupt(threadId, turnId);
        if (threadId) await client.releaseThread(threadId);
        active = false;
        cancelActive = undefined;
      }
    },
    dispose() {
      disposed = true;
      cancelActive?.();
      client.dispose();
    },
  };
  void refresh().catch(() => logger.warn('Codex 桌宠尚未连接；可在桌宠设置中重试。'));
  return service;
}
