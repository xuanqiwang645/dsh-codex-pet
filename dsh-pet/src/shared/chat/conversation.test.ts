import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mountConversationDialog } from './conversation.ts';

class Element extends EventTarget {
  children: Element[] = [];
  parentElement: Element | null = null;
  className = '';
  textContent = '';
  value = '';
  disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  scrollTop = 0;
  scrollHeight = 100;
  focused = false;
  readonly tag: string;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  append(...children: Element[]) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  focus() {
    this.focused = true;
  }
  getBoundingClientRect() {
    return {
      width: Number.parseFloat(this.style.width || '360'),
      height: Number.parseFloat(this.style.height || '420'),
    };
  }
  find(tag: string): Element[] {
    return this.children.flatMap((child) => [...(child.tag === tag ? [child] : []), ...child.find(tag)]);
  }
  get allText(): string {
    return this.textContent + this.children.map((child) => child.allText).join('');
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<unknown> | unknown;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function key(name: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event('keydown', { cancelable: true });
  for (const [property, value] of Object.entries({ key: name, shiftKey: false, isComposing: false, ...extra }))
    Object.defineProperty(event, property, { value });
  return event;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness(
  fetcher: Fetcher,
  run: (state: {
    body: Element;
    doc: EventTarget;
    root: Element;
    input: Element;
    form: Element;
    close(): void;
    closes(): number;
  }) => Promise<void>,
  petName?: string,
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map(['document', 'window', 'fetch'].map((name) => [name, globals[name]]));
  const body = new Element('body');
  const doc = Object.assign(new EventTarget(), { body, createElement: (tag: string) => new Element(tag) });
  globals.document = doc;
  globals.window = { innerWidth: 600, innerHeight: 600, setTimeout, clearTimeout };
  globals.fetch = async (url: string, init: RequestInit) => new Response(JSON.stringify(await fetcher(url, init)));
  let closed = 0;
  const mount = mountConversationDialog({
    petId: 'main',
    petName,
    surface: 'desktop',
    x: 590,
    y: 590,
    clamp: { x: 20, y: 30, w: 500, h: 500 },
    onClose: () => {
      closed++;
    },
  });
  const root = mount.el as unknown as Element;
  try {
    await run({
      body,
      doc,
      root,
      input: root.find('textarea')[0],
      form: root.find('form')[0],
      close: mount.close,
      closes: () => closed,
    });
  } finally {
    mount.close();
    for (const [name, value] of saved) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  }
}

test('persistent conversation loads history safely, stays inside clamp and only closes explicitly', async () => {
  await harness(
    () => ({
      ok: true,
      messages: [
        { role: 'user', content: '<img src=x onerror=alert(1)>' },
        { role: 'assistant', content: '在这里' },
      ],
    }),
    async ({ body, doc, root, close, closes }) => {
      await tick();
      assert.match(root.allText, /<img src=x onerror=alert\(1\)>/);
      assert.match(root.allText, /在这里/);
      assert.equal(root.attributes.get('aria-label'), '鲸鱼娘对话');
      assert.match(root.allText, /鲸鱼娘 · 对话/);
      assert.equal(root.find('img').length, 0);
      assert.equal(root.style.left, '156px');
      assert.equal(root.style.top, '106px');
      doc.dispatchEvent(new Event('mousedown'));
      assert.equal(body.children.length, 1);
      root
        .find('button')
        .find((node) => node.textContent === '关闭')!
        .dispatchEvent(new Event('click'));
      assert.equal(body.children.length, 0);
      close();
      assert.equal(closes(), 1);
      doc.dispatchEvent(key('Escape'));
      assert.equal(closes(), 1);
    },
  );
});

test('selected character identity appears in the dialog, history and reply states as safe text', async () => {
  const reply = deferred<unknown>();
  const name = 'ChatGPT 白龙娘 <img src=x>';
  await harness(
    (_url, init) => (init.method === 'POST' ? reply.promise : { ok: true, messages: [] }),
    async ({ root, input, form }) => {
      await tick();
      assert.equal(root.attributes.get('aria-label'), name + '对话');
      assert.match(root.allText, /ChatGPT 白龙娘 <img src=x> · 对话/);
      assert.match(root.allText, /发一句消息，ChatGPT 白龙娘 <img src=x>会在这里回复。/);
      assert.doesNotMatch(root.allText, /鲸鱼娘/);
      input.value = '你好';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      assert.match(root.allText, /ChatGPT 白龙娘 <img src=x>正在回复/);
      reply.resolve({ ok: true, text: '白龙娘在这里。' });
      await tick();
      assert.ok(root.find('b').some((node) => node.textContent === name));
      assert.equal(root.find('img').length, 0);
      assert.doesNotMatch(root.allText, /鲸鱼娘/);
    },
    name,
  );
});

test('sending keeps panel and reply visible, blocks duplicates and ignores late history', async () => {
  const history = deferred<unknown>();
  const reply = deferred<unknown>();
  const posts: string[] = [];
  await harness(
    (_url, init) => {
      if (init.method === 'POST') {
        posts.push(String(init.body));
        return reply.promise;
      }
      return history.promise;
    },
    async ({ body, root, input, form }) => {
      input.value = '你好';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      assert.equal(input.disabled, true);
      assert.match(root.allText, /正在回复/);
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      assert.equal(posts.length, 1);
      assert.deepEqual(JSON.parse(posts[0]), { text: '你好' });
      reply.resolve({ ok: true, text: '我在这里，<script>也只作为文字</script>' });
      await tick();
      assert.equal(body.children.length, 1);
      assert.match(root.allText, /我在这里/);
      assert.match(root.allText, /你好/);
      assert.equal(root.find('script').length, 0);
      assert.equal(input.value, '');
      assert.equal(input.disabled, false);
      history.resolve({ ok: true, messages: [{ role: 'assistant', content: 'stale history' }] });
      await tick();
      assert.doesNotMatch(root.allText, /stale history/);
      assert.match(root.allText, /我在这里/);
    },
  );
});

test('failed sends retain draft for retry and composition/Shift+Enter never submit', async () => {
  let posts = 0;
  await harness(
    (_url, init) => {
      if (init.method === 'POST') {
        posts++;
        return posts === 1 ? { ok: false, message: '模型暂不可用' } : { ok: true, text: '恢复了' };
      }
      return { ok: true, messages: [] };
    },
    async ({ root, input, form }) => {
      await tick();
      input.value = '继续聊';
      input.dispatchEvent(key('Enter', { shiftKey: true }));
      input.dispatchEvent(key('Enter', { isComposing: true }));
      input.dispatchEvent(new Event('compositionstart'));
      input.dispatchEvent(key('Enter'));
      assert.equal(posts, 0);
      input.dispatchEvent(new Event('compositionend'));
      const enter = key('Enter');
      input.dispatchEvent(enter);
      assert.equal(enter.defaultPrevented, true);
      await tick();
      assert.equal(input.value, '继续聊');
      assert.equal(input.disabled, false);
      assert.match(root.allText, /模型暂不可用/);
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await tick();
      assert.equal(posts, 2);
      assert.match(root.allText, /恢复了/);
      assert.equal(root.find('p').filter((item) => item.textContent === '继续聊').length, 1);
    },
  );
});

test('closing while history or reply is pending prevents late rendering and aborts requests', async () => {
  const history = deferred<unknown>();
  let sendSignal: AbortSignal | undefined;
  await harness(
    (_url, init) => {
      if (init.method !== 'POST') return history.promise;
      sendSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        sendSignal!.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
    async ({ root, input, form, close, body }) => {
      input.value = '在吗';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      close();
      assert.equal(sendSignal?.aborted, true);
      history.resolve({ ok: true, messages: [{ role: 'assistant', content: 'late text' }] });
      await tick();
      assert.equal(body.children.length, 0);
      assert.doesNotMatch(root.allText, /late text/);
    },
  );
});

test('desktop runtime opens persistent Codex conversation while DSH retains quick chat', () => {
  const source = readFileSync(new URL('../../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8');
  for (const target of ['codex', 'desktop', 'standalone', 'web']) {
    let mode = '';
    let settings = 0;
    let options: { allowImages?: boolean; petName?: string; onSettings?: () => void } = {};
    class Sprite {
      chatClose = null;
      pet = { id: 'chatgpt-dragon', name: 'ChatGPT 白龙娘' };
      hit = { getBoundingClientRect: () => ({ right: 30, top: 20 }) };
      syncInputBusy() {}
      setInteractive() {}
      visibleClampRect() {
        return { x: 0, y: 0, w: 600, h: 600 };
      }
    }
    const mount = (name: string) => (value: typeof options) => {
      mode = name;
      options = value;
      return { close() {} };
    };
    runInNewContext(source, {
      PetSprite: Sprite,
      OPEN_TARGET: target,
      BASE: '/dsh-pet-7340',
      window: {
        __dshPetDebug: {},
        petBridge: {
          openSettings() {
            settings++;
          },
        },
      },
      S: { setVoiceBase() {}, mountChatDialog: mount('quick'), mountConversationDialog: mount('persistent') },
    });
    (new Sprite() as Sprite & { showChatFromMenu(): void }).showChatFromMenu();
    assert.equal(mode, target === 'codex' ? 'persistent' : 'quick');
    assert.equal(options.allowImages, target !== 'codex');
    assert.equal(options.petName, target === 'codex' ? 'ChatGPT 白龙娘' : undefined);
    options.onSettings?.();
    assert.equal(settings, target === 'codex' ? 1 : 0);
  }
});
