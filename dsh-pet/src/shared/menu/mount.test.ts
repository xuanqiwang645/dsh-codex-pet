import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountContextMenu } from './mount.ts';

class MenuElement extends EventTarget {
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: MenuElement[] = [];
  parentElement: MenuElement | null = null;
  textContent = '';
  tabIndex = -1;
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
  readonly owner: MenuDocument;
  constructor(owner: MenuDocument) {
    super();
    this.owner = owner;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child: MenuElement) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  contains(target: MenuElement): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }
  get offsetWidth() {
    return 180;
  }
  get offsetHeight() {
    return Math.max(30, this.children.length * 30);
  }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left || '10');
    const top = Number.parseFloat(this.style.top || '10');
    return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight };
  }
  querySelectorAll(selector: string): MenuElement[] {
    const matches = (element: MenuElement) =>
      selector === '[role="menuitem"]'
        ? element.getAttribute('role') === 'menuitem'
        : element.className.split(' ').includes(selector.slice(1));
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    this.owner.activeElement = this;
  }
}

class MenuDocument extends EventTarget {
  body = new MenuElement(this);
  activeElement: MenuElement | null = null;
  createElement() {
    return new MenuElement(this);
  }
}

function withMenuDom(run: (document: MenuDocument) => void) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globals.document;
  const previousWindow = globals.window;
  const document = new MenuDocument();
  globals.document = document;
  globals.window = { innerWidth: 1000, innerHeight: 800, setTimeout, clearTimeout };
  try {
    run(document);
  } finally {
    if (previousDocument === undefined) delete globals.document;
    else globals.document = previousDocument;
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
  }
}

function keyEvent(key: string) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

test('menu exposes actionable roles before hover and click opens branches without dispatching an action', () => {
  withMenuDom((document) => {
    let actions = 0;
    const menu = mountContextMenu({
      tree: [
        { label: '对话', action: 'chat' },
        { label: '喂食', children: [{ label: '吃米饭', anim: '吃白饭' }] },
        { label: '玩耍', children: [{ label: '玩魔方', anim: '魔方' }] },
      ],
      x: 10,
      y: 10,
      onAction: () => {
        actions++;
      },
    });
    const root = menu.el as unknown as MenuElement;
    const panels = root.querySelectorAll('.dsh-pet-menu-column');
    assert.equal(panels[0].getAttribute('role'), 'menu');
    assert.equal(panels[0].getAttribute('aria-label'), '宠物菜单');
    const items = root.querySelectorAll('[role="menuitem"]');
    assert.equal(items.length, 5);
    assert.ok(items.every((item) => item.tabIndex === 0 && item.getAttribute('aria-label')));
    const food = items.find((item) => item.getAttribute('aria-label') === '喂食')!;
    const play = items.find((item) => item.getAttribute('aria-label') === '玩耍')!;
    assert.equal(food.getAttribute('aria-haspopup'), 'menu');
    assert.equal(food.getAttribute('aria-expanded'), 'false');
    food.dispatchEvent(new Event('click', { cancelable: true }));
    assert.equal(food.getAttribute('aria-expanded'), 'true');
    assert.equal(panels.find((panel) => panel.getAttribute('aria-label') === '喂食')?.style.display, 'block');
    play.dispatchEvent(new Event('mouseenter'));
    assert.equal(food.getAttribute('aria-expanded'), 'false');
    assert.equal(play.getAttribute('aria-expanded'), 'true');
    assert.equal(actions, 0);
    menu.close();
    assert.equal(document.body.children.length, 0);
  });
});

test('Enter opens a submenu and focuses its first item; Space activates the leaf exactly once', () => {
  withMenuDom((document) => {
    const actions: string[] = [];
    let closes = 0;
    const menu = mountContextMenu({
      tree: [{ label: '喂食', children: [{ label: '吃米饭', anim: '吃白饭' }] }],
      x: 10,
      y: 10,
      onAction: (leaf) => actions.push(leaf.anim!),
      onClose: () => {
        closes++;
      },
    });
    const items = (menu.el as unknown as MenuElement).querySelectorAll('[role="menuitem"]');
    const branch = items.find((item) => item.getAttribute('aria-label') === '喂食')!;
    branch.dispatchEvent(keyEvent('Enter'));
    const leaf = items.find((item) => item.getAttribute('aria-label') === '吃米饭')!;
    assert.equal(document.activeElement, leaf);
    const space = keyEvent(' ');
    leaf.dispatchEvent(space);
    assert.equal(space.defaultPrevented, true);
    assert.deepEqual(actions, ['吃白饭']);
    assert.equal(closes, 1);
    menu.close();
    assert.equal(closes, 1);
  });
});

test('nonactivation keys leave menu open and Escape still closes without dispatching actions', () => {
  withMenuDom((document) => {
    let actions = 0;
    let closes = 0;
    const menu = mountContextMenu({
      tree: [{ label: '对话', action: 'chat' }],
      x: 10,
      y: 10,
      onAction: () => {
        actions++;
      },
      onClose: () => {
        closes++;
      },
    });
    const leaf = (menu.el as unknown as MenuElement).querySelector('[role="menuitem"]')!;
    leaf.dispatchEvent(keyEvent('a'));
    assert.equal(closes, 0);
    document.dispatchEvent(keyEvent('Escape'));
    assert.equal(closes, 1);
    assert.equal(actions, 0);
    assert.equal(document.body.children.length, 0);
    document.dispatchEvent(keyEvent('Escape'));
    assert.equal(closes, 1);
  });
});
