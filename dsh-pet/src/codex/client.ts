/** Local Codex app-server transport. It never reads or copies login secrets. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

type RecordValue = Record<string, unknown>;
export type RpcMessage = RecordValue & { method?: string; params?: RecordValue };
export type SpawnCodex = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe' },
) => ChildProcessWithoutNullStreams;
export interface CodexClientOptions {
  executable?: string;
  spawn?: SpawnCodex;
  requestTimeoutMs?: number;
}
export interface CodexAccount {
  connected: boolean;
  type: string | null;
  planType: string | null;
}
export interface CodexModel {
  id: string;
  name: string;
  isDefault: boolean;
  efforts: string[];
}
const PROFILE = 'dsh-pet-chat';
const DISABLED_FEATURES = [
  'apps',
  'plugins',
  'plugin_hooks',
  'hooks',
  'codex_hooks',
  'shell_tool',
  'unified_exec',
  'view_image',
  'web_search',
  'web_search_request',
  'web_search_cached',
  'standalone_web_search',
  'tool_search',
  'tool_suggest',
  'multi_agent',
  'collab',
  'computer_use',
  'browser_use',
  'image_generation',
  'js_repl',
  'code_mode',
  'code_mode_only',
  'memories',
  'memory_tool',
  'shell_snapshot',
];

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}
function safeError(message = 'Codex 连接失败，请确认桌面应用已登录后重试。', cause?: unknown): Error {
  return new Error(message, cause ? { cause } : undefined);
}
function executable(): string {
  if (process.env.DSH_CODEX_CLI) return process.env.DSH_CODEX_CLI;
  const candidates = [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    join(homedir(), '.local/bin/codex'),
  ];
  return candidates.find(existsSync) ?? 'codex';
}

/** Only launches a local subprocess; auth stays in Codex's managed storage. */
export class CodexClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private started: Promise<void> | undefined;
  private nextId = 0;
  private buffer = '';
  private readonly listeners = new Set<(message: RpcMessage) => void>();
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private disposed = false;
  readonly workspace: string;
  private readonly options: CodexClientOptions;

  constructor(home: string, options: CodexClientOptions = {}) {
    this.workspace = resolve(home, 'dsh-pet', 'codex-chat-workspace');
    this.options = options;
  }
  onNotification(listener: (message: RpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async start(): Promise<void> {
    if (this.disposed) throw safeError('Codex 桌宠连接已关闭。');
    if (this.started) return this.started;
    this.started = this.boot();
    try {
      await this.started;
    } catch (error) {
      this.close(false);
      throw error;
    }
  }
  private async boot(): Promise<void> {
    mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
    // Overrides affect this child process only. No config or auth file is edited.
    const args = ['app-server', '--stdio'];
    for (const name of DISABLED_FEATURES) args.push('-c', `features.${name}=false`);
    args.push(
      '-c',
      'features.skip_host_skill_discovery=true',
      '-c',
      'web_search="disabled"',
      '-c',
      'tools.update_plan.enabled=false',
    );
    const child = (this.options.spawn ?? spawn)(this.options.executable ?? executable(), args, {
      cwd: this.workspace,
      env: { ...process.env },
      stdio: 'pipe',
    });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 4_194_304) {
        this.close(false);
        return;
      }
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          this.receive(record(JSON.parse(line)));
        } catch {
          this.close(false);
          break;
        }
      }
    });
    // CLI stderr can contain request context. Drain it but never mirror it into logs/UI.
    child.stderr.on('data', () => undefined);
    child.on('error', () => {
      if (this.child === child) this.close(false);
    });
    child.on('close', () => {
      if (this.child === child) this.close(false);
    });
    await this.send('initialize', {
      clientInfo: { name: 'dsh_codex_pet', title: 'DSH Codex Pet', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.write({ method: 'initialized', params: {} });
  }
  private write(message: RecordValue): void {
    if (!this.child || this.child.stdin.destroyed) throw safeError();
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private receive(message: RecordValue): void {
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if ('error' in message) pending.reject(safeError(undefined, message.error));
      else pending.resolve(message.result);
      return;
    }
    if ('id' in message && typeof message.method === 'string') {
      // Never accept an action, external token handoff, or interactive approval.
      if (message.method.endsWith('/requestApproval')) this.write({ id: message.id, result: { decision: 'decline' } });
      else
        this.write({
          id: message.id,
          error: { code: -32601, message: 'This pet client does not provide interactive actions.' },
        });
      return;
    }
    if (typeof message.method === 'string') for (const listener of this.listeners) listener(message as RpcMessage);
  }
  private send(
    method: string,
    params: RecordValue = {},
    timeoutMs = this.options.requestTimeoutMs ?? 15_000,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(safeError('Codex 请求超时，请稍后重试。'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(safeError());
      }
    });
  }
  async readAccount(): Promise<CodexAccount> {
    await this.start();
    const result = record(await this.send('account/read', { refreshToken: false }));
    const account = record(result.account);
    return {
      // This integration uses an existing ChatGPT plan; never silently fall back
      // to an API-key or cloud-provider account with different billing.
      connected: account.type === 'chatgpt',
      type: typeof account.type === 'string' ? account.type : null,
      planType: typeof account.planType === 'string' ? account.planType : null,
    };
  }
  async readRateLimits(): Promise<unknown> {
    await this.start();
    return this.send('account/rateLimits/read');
  }
  async listModels(): Promise<CodexModel[]> {
    await this.start();
    const models: CodexModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = record(
        await this.send('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }),
      );
      for (const raw of Array.isArray(response.data) ? response.data : []) {
        const item = record(raw);
        if (typeof item.model !== 'string') continue;
        models.push({
          id: item.model,
          name: typeof item.displayName === 'string' ? item.displayName : item.model,
          isDefault: item.isDefault === true,
          efforts: (Array.isArray(item.supportedReasoningEfforts) ? item.supportedReasoningEfforts : [])
            .map((effort) => record(effort).reasoningEffort)
            .filter((effort): effort is string => typeof effort === 'string'),
        });
      }
      if (typeof response.nextCursor !== 'string' || !response.nextCursor) return models;
      if (response.nextCursor === cursor) throw safeError();
      cursor = response.nextCursor;
    }
    throw safeError();
  }
  /** Starts an ephemeral chat with an explicit named read-only/network-denied profile. */
  async startChat(model: string, instructions: string): Promise<{ threadId: string; effort?: string }> {
    await this.start();
    const rawConfig = record(
      record(await this.send('config/read', { includeLayers: false, cwd: this.workspace })).config,
    );
    const config: RecordValue = {};
    // Only names are extracted; no configuration values are returned or persisted.
    for (const name of Object.keys(record(rawConfig.mcp_servers))) {
      // RPC override keys are dot paths, not TOML source. Refuse ambiguous names.
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw safeError('本机某个 MCP 名称不支持隔离，桌宠聊天已停止。');
      config[`mcp_servers.${name}.enabled`] = false;
    }
    for (const name of DISABLED_FEATURES) config[`features.${name}`] = false;
    config['features.skip_host_skill_discovery'] = true;
    config['plugins._default.enabled'] = false;
    config['apps._default.enabled'] = false;
    config['web_search'] = 'disabled';
    config['tools.update_plan.enabled'] = false;
    config['tools.experimental_request_user_input.enabled'] = false;
    config['model_reasoning_effort'] = 'low';
    config[`permissions.${PROFILE}`] = {
      description: 'Pet chat: dedicated read-only workspace, no tool network',
      filesystem: {
        ':root': 'deny',
        ':minimal': 'read',
        ':workspace_roots': { '.': 'read' },
        ':tmpdir': 'deny',
        ':slash_tmp': 'deny',
      },
      network: { enabled: false },
    };
    config['default_permissions'] = PROFILE;
    const result = record(
      await this.send('thread/start', {
        model,
        modelProvider: 'openai',
        cwd: this.workspace,
        runtimeWorkspaceRoots: [this.workspace],
        permissions: PROFILE,
        approvalPolicy: 'never',
        ephemeral: true,
        environments: [],
        dynamicTools: [],
        selectedCapabilityRoots: [],
        config,
        baseInstructions: instructions,
        developerInstructions:
          '你是本地桌面宠物的聊天伙伴。只根据用户消息进行简短自然的对话；不执行任务、不访问文件、命令、网络、浏览器或外部工具。不要声称执行过现实操作。',
      }),
    );
    const threadId = record(result.thread).id;
    const sandbox = record(result.sandbox);
    if (
      typeof threadId !== 'string' ||
      record(result.activePermissionProfile).id !== PROFILE ||
      result.approvalPolicy !== 'never' ||
      sandbox.networkAccess !== false ||
      sandbox.type !== 'readOnly'
    ) {
      this.close(false);
      throw safeError('当前 Codex 版本未能启用桌宠只读隔离，聊天已停止。');
    }
    return { threadId };
  }
  async startTurn(threadId: string, text: string): Promise<string> {
    const result = record(
      await this.send('turn/start', {
        threadId,
        input: [{ type: 'text', text }],
        permissions: PROFILE,
        approvalPolicy: 'never',
        environments: [],
        effort: 'low',
      }),
    );
    const id = record(result.turn).id;
    if (typeof id !== 'string') throw safeError();
    return id;
  }
  async interrupt(threadId: string, turnId: string): Promise<void> {
    if (!this.child) return;
    try {
      await this.send('turn/interrupt', { threadId, turnId }, 2000);
    } catch {
      this.close(false);
    }
  }
  async releaseThread(threadId: string): Promise<void> {
    if (!this.child) return;
    try {
      await this.send('thread/unsubscribe', { threadId }, 2000);
    } catch {
      /* ephemerals leave no saved thread */
    }
  }
  /** Restartable close for cancelled requests; dispose is final. */
  close(final = false): void {
    this.disposed ||= final;
    const child = this.child;
    this.child = undefined;
    this.started = undefined;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(safeError('Codex 连接已关闭。'));
    }
    this.pending.clear();
    child?.stdin.destroy();
    child?.kill();
  }
  dispose(): void {
    this.close(true);
    this.listeners.clear();
  }
}

/** Missing percentages stay null; values are clamped to the inclusive 0–100 range. */
export function remainingPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, 100 - value)) : null;
}
