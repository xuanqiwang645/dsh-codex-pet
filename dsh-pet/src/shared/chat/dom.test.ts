import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatDom } from './dom.ts';
import type { EncodedImage } from './encode.ts';

class ChatElement extends EventTarget {
  className = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ChatElement[] = [];
  parentElement: ChatElement | null = null;
  value = '';
  scrollHeight = 22;
  disabled = false;
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  append(...children: ChatElement[]) {
    for (const child of children) this.appendChild(child);
  }
  appendChild(child: ChatElement) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  getContext() {
    return { font: '', measureText: (text: string) => ({ width: text.length * 8 }) };
  }
  get isConnected(): boolean {
    return this.className === 'test-body' || !!this.parentElement?.isConnected;
  }
  queryClass(name: string): ChatElement[] {
    return this.children.flatMap((child) => [...(child.className === name ? [child] : []), ...child.queryClass(name)]);
  }
}

async function withChatDom(run: (body: ChatElement) => Promise<void>) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['document', 'window', 'getComputedStyle'].map((name) => [name, globals[name]]));
  const body = new ChatElement();
  body.className = 'test-body';
  globals.document = { body, createElement: () => new ChatElement(), createElementNS: () => new ChatElement() };
  globals.window = { setTimeout, clearTimeout };
  globals.getComputedStyle = () => ({ font: '14px sans-serif' });
  try {
    await run(body);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  }
}

const encoded = { mediaType: 'image/png', base64: 'AA==', previewUrl: 'data:image/png;base64,AA==' } as EncodedImage;

test('text-only chat hides image controls and rejects file/encoded attachment paths', async () => {
  await withChatDom(async (body) => {
    let captures = 0;
    const chat = createChatDom({
      allowImages: false,
      capture: async () => {
        captures++;
        return encoded;
      },
    });
    assert.equal(body.queryClass('dsh-pet-chat-actions').length, 0);
    assert.equal(body.queryClass('dsh-pet-chat-btn').length, 0);
    assert.equal(await chat.setImageFile({ type: 'image/png', name: 'a.png' } as File), false);
    assert.equal(chat.setEncoded(encoded), false);
    assert.equal(chat.getAttachment(), undefined);
    chat.shotBtn.dispatchEvent(new Event('click'));
    assert.equal(captures, 0);
    chat.dispose();
  });
});

test('default chat keeps existing image controls and supports encoded attachments', async () => {
  await withChatDom(async (body) => {
    const chat = createChatDom();
    assert.equal(body.queryClass('dsh-pet-chat-actions').length, 1);
    assert.equal(body.queryClass('dsh-pet-chat-btn').length, 2);
    assert.equal(chat.setEncoded(encoded), true);
    assert.deepEqual(chat.getAttachment(), { mediaType: 'image/png', data: 'AA==' });
    chat.clearAttach();
    assert.equal(chat.getAttachment(), undefined);
    chat.dispose();
  });
});
