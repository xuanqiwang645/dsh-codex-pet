/** Persistent text conversation for the Codex companion; upstream quick chat stays unchanged. */
import { ROUTE_PATH } from '../constants.ts';
import type { ChatDialogMount, ChatDialogOptions } from './dialog.ts';

export interface ConversationDialogOptions extends ChatDialogOptions {
  /** Display identity for the selected character; legacy callers keep the whale name. */
  petName?: string;
  onSettings?: () => void;
}

const CSS = `
.dsh-pet-conversation{position:fixed;z-index:2147483001;display:flex;flex-direction:column;box-sizing:border-box;background:#fff;color:#23354e;border:1px solid #dce3ed;border-radius:12px;box-shadow:0 8px 28px #182a4b33;font:14px/1.55 "PingFang SC",system-ui,sans-serif;overflow:hidden;user-select:text}
.dsh-pet-conversation *{box-sizing:border-box}.dsh-pet-conversation header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e4e9f1;flex-shrink:0}.dsh-pet-conversation strong{flex:1;font-size:15px}.dsh-pet-conversation button{font:inherit;cursor:pointer;border:1px solid #c5d0e0;border-radius:6px;padding:5px 9px;background:#fff;color:#34558f}.dsh-pet-conversation button:disabled{opacity:.55;cursor:wait}.dsh-pet-conversation button:focus-visible,.dsh-pet-conversation textarea:focus-visible{outline:2px solid #7294d4;outline-offset:-2px}.dsh-pet-conversation-log{flex:1;min-height:30px;overflow-y:auto;padding:10px 12px;overscroll-behavior:contain}.dsh-pet-conversation-message{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-pet-conversation-message b{display:block;font-size:11px;color:#697b94;margin-bottom:3px}.dsh-pet-conversation-message p{margin:0}.dsh-pet-conversation-message[data-role=user]{background:#eef3fc;padding:7px 9px;border-radius:8px}.dsh-pet-conversation-status{padding:4px 12px;color:#64758c;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;flex-shrink:0}.dsh-pet-conversation-status[data-error=true]{color:#ad3c36}.dsh-pet-conversation form{padding:8px 12px 11px;border-top:1px solid #e4e9f1;flex-shrink:0}.dsh-pet-conversation textarea{display:block;width:100%;height:64px;max-height:100px;resize:vertical;padding:7px 9px;border:1px solid #bdc9db;border-radius:6px;background:#fff;color:#23354e;font:inherit;user-select:text}.dsh-pet-conversation footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px}.dsh-pet-conversation footer span{font-size:10px;color:#64758c}.dsh-pet-conversation button[type=submit]{background:#4564a7;color:#fff;border-color:#4564a7}
`;

/** Keep replies and recent history visible until the user explicitly closes the panel. */
export function mountConversationDialog(opts: ConversationDialogOptions): ChatDialogMount {
  const petName = typeof opts.petName === 'string' && opts.petName.trim() ? opts.petName.trim() : '鲸鱼娘';
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = element('div');
  root.className = 'dsh-pet-chat dsh-pet-conversation';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', petName + '对话');
  const style = element('style', CSS);
  const header = element('header');
  header.append(element('strong', petName + ' · 对话'));
  if (opts.onSettings) {
    const settings = element('button', '选择模型');
    settings.type = 'button';
    settings.addEventListener('click', () => opts.onSettings?.());
    header.append(settings);
  }
  const closeButton = element('button', '关闭');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭对话');
  header.append(closeButton);
  const log = element('div');
  log.className = 'dsh-pet-conversation-log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', petName + '对话记录');
  log.setAttribute('aria-live', 'polite');
  const status = element('div', '正在读取最近对话…');
  status.className = 'dsh-pet-conversation-status';
  status.setAttribute('role', 'status');
  const form = element('form');
  const input = element('textarea');
  input.placeholder = '说点什么…';
  input.setAttribute('aria-label', '对话消息');
  input.maxLength = 2000;
  input.rows = 2;
  const footer = element('footer');
  const send = element('button', '发送');
  send.type = 'submit';
  footer.append(element('span', '回车发送 · Shift+回车换行'), send);
  form.append(input, footer);
  root.append(style, header, log, status, form);
  document.body.append(root);

  const baseUrl = opts.baseUrl ?? ROUTE_PATH + '/chat';
  const withPet = baseUrl + '?pet=' + encodeURIComponent(opts.petId);
  const clamp = opts.clamp;
  const c =
    clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) && clamp.w > 0 && clamp.h > 0
      ? clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  root.style.width = Math.min(360, Math.max(1, c.w - 8)) + 'px';
  root.style.height = Math.min(420, Math.max(1, c.h - 8)) + 'px';
  const place = (): void => {
    const rect = root.getBoundingClientRect();
    root.style.left = Math.max(c.x + 4, Math.min(opts.x, c.x + c.w - rect.width - 4)) + 'px';
    root.style.top = Math.max(c.y + 4, Math.min(opts.y, c.y + c.h - rect.height - 4)) + 'px';
  };
  place();
  const historyAbort = new AbortController();
  let sendingAbort: AbortController | undefined;
  let sending = false;
  let composing = false;
  let closed = false;
  let interacted = false;
  const setStatus = (message: string, error = false): void => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const addMessage = (role: 'user' | 'assistant', text: string): HTMLElement => {
    const row = element('div');
    row.className = 'dsh-pet-conversation-message';
    row.dataset.role = role;
    row.append(element('b', role === 'user' ? '你' : petName), element('p', text));
    log.append(row);
    log.scrollTop = log.scrollHeight;
    return row;
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.isComposing && !composing) close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    historyAbort.abort();
    sendingAbort?.abort();
    document.removeEventListener('keydown', onEscape, true);
    root.remove();
    opts.onClose?.();
  };
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onEscape, true);
  const request = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', ...init });
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('对话响应无效，请重试。');
    const result = data as Record<string, unknown>;
    if (!response.ok || result.ok !== true) {
      throw new Error(typeof result.message === 'string' ? result.message : '对话暂时不可用，请重试。');
    }
    return result;
  };
  void request(withPet + '&rounds=20', { signal: historyAbort.signal })
    .then((result) => {
      if (closed || interacted) return;
      const messages = Array.isArray(result.messages) ? result.messages : [];
      for (const raw of messages) {
        if (!raw || typeof raw !== 'object') continue;
        const message = raw as Record<string, unknown>;
        if ((message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
          addMessage(message.role, message.content);
      }
      setStatus(messages.length ? '最近对话已载入。' : '发一句消息，' + petName + '会在这里回复。');
    })
    .catch(() => {
      if (!closed && !interacted) setStatus('最近记录暂时无法读取，仍可发送新消息。', true);
    });

  const doSend = async (): Promise<void> => {
    if (closed || sending || composing) return;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    if (text.length > 2000) {
      setStatus('消息过长，最多 2000 字。', true);
      return;
    }
    interacted = true;
    sending = true;
    input.disabled = true;
    send.disabled = true;
    setStatus(petName + '正在回复…');
    const pending = addMessage('user', text);
    const controller = new AbortController();
    sendingAbort = controller;
    const timeout = window.setTimeout(() => controller.abort(), 65_000);
    try {
      const result = await request(withPet + '&surface=' + opts.surface, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (closed) return;
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('尚未收到文字回复，请稍后重试。');
      addMessage('assistant', result.text);
      input.value = '';
      setStatus('已回复，可继续对话。');
      opts.onSent?.();
    } catch (error) {
      if (closed) return;
      pending.remove();
      setStatus(
        '对话失败：' +
          (controller.signal.aborted ? '等待超时，请重试。' : error instanceof Error ? error.message : '请重试。'),
        true,
      );
    } finally {
      window.clearTimeout(timeout);
      sendingAbort = undefined;
      sending = false;
      if (!closed) {
        input.disabled = false;
        send.disabled = false;
        input.focus();
      }
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void doSend();
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing) {
      event.preventDefault();
      void doSend();
    }
  });
  input.focus();
  return { el: root, close };
}
