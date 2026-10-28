import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { displayMenuBranch } from '../shared/menu/tree.ts';

const menuSource = readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8');
const { createTray } = createRequire(import.meta.url)('../../runtime/electron-helper/main/tray.js');

type MenuItem = { label?: string; display?: string; children?: MenuItem[]; checked?: boolean; click?: () => void };

function menuHarness(target: string) {
  let tree: MenuItem[] = [];
  const requests: string[] = [];
  class Sprite {
    dragState = {};
    menuOpen = false;
    justDragged = false;
    animations = {};
    menuItems = [];
    pet = { id: 'main' };
    stopThrow() {}
    stopMove() {}
    closeMenu() {}
    setInteractive() {}
    syncInputBusy() {}
    syncInputRegions() {}
    inputBusy() {
      return false;
    }
    visibleClampRect() {
      return { x: 0, y: 0, w: 500, h: 500 };
    }
  }
  runInNewContext(menuSource, {
    Object,
    PetSprite: Sprite,
    OPEN_TARGET: target,
    OPEN_SHORTCUT_HINT: '',
    BASE: '/dsh-pet-7340',
    window: { __dshPetDebug: {} },
    fetch: async (_path: string, options: { body: string }) => {
      requests.push(JSON.parse(options.body).display);
    },
    S: {
      CHAT_HOTKEY_HINT: '',
      displayMenuBranch,
      buildMoreBranch: () => null,
      buildMenuTree: () => [],
      mountContextMenu: (options: { tree: MenuItem[] }) => {
        tree = options.tree;
        return { close() {} };
      },
    },
  });
  const sprite = new Sprite() as Sprite & {
    onContextMenu(event: unknown): void;
    onMenuAction(leaf: unknown): void;
    setPetDisplay(display: string): void;
  };
  sprite.onContextMenu({ preventDefault() {}, clientX: 10, clientY: 10 });
  return { sprite, tree, requests };
}

test('Codex menu removes the display branch and stale menu actions cannot change display', () => {
  const { sprite, tree, requests } = menuHarness('codex');
  assert.equal(
    tree.some((item) => item.label === '显示位置'),
    false,
  );
  assert.equal(
    tree.some((item) => item.label === '桌宠设置'),
    true,
  );
  for (const display of ['web', 'both', 'desktop', 'none']) {
    sprite.onMenuAction({ action: 'set-display', display });
    sprite.setPetDisplay(display);
  }
  assert.deepEqual(requests, []);
});

test('DSH desktop, standalone and web hosts retain the existing display menu and behavior', () => {
  for (const target of ['desktop', 'standalone', 'web']) {
    const { sprite, tree, requests } = menuHarness(target);
    const branch = tree.find((item) => item.label === '显示位置');
    assert.deepEqual(
      branch?.children?.map((item) => item.display),
      ['web', 'desktop', 'both', 'none'],
    );
    sprite.onMenuAction({ action: 'set-display', display: 'web' });
    assert.deepEqual(requests, ['web']);
  }
});

async function trayHarness(target: string, display: string) {
  let template: MenuItem[] = [];
  const writes: Array<{ id: string; display: string }> = [];
  const image = { isEmpty: () => false, resize: () => image, setTemplateImage() {} };
  class Tray {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  }
  const tray = createTray({
    app: { quit() {} },
    Tray,
    Menu: {
      buildFromTemplate(items: MenuItem[]) {
        template = items;
        return items;
      },
    },
    nativeImage: { createFromPath: () => image },
    hostRequest: async (method: string, _path: string, body?: string) => {
      if (method === 'GET')
        return { body: JSON.stringify({ main: { pets: [{ id: 'main', name: '鲸鱼娘', display }] } }) };
      writes.push(JSON.parse(body!));
      return { body: '{}' };
    },
    callbackUrl: () => '',
    isBridge: false,
    appMode: true,
    openTarget: target,
    petRoute: '/dsh-pet-7340',
    platform: {},
    helperDir: '/fixture/runtime/electron-helper',
  });
  await tray.start();
  assert.equal(tray.exists(), true);
  const item = template.find((entry) => entry.label === '鲸鱼娘');
  assert.ok(item?.click);
  item.click();
  return { checked: item.checked, writes };
}

test('Codex tray only writes desktop or none, including legacy web and both settings', async () => {
  for (const display of ['web', 'both', 'desktop', 'none']) {
    const result = await trayHarness('codex', display);
    const visible = display !== 'none';
    assert.equal(result.checked, visible);
    assert.deepEqual(result.writes, [{ id: 'main', display: visible ? 'none' : 'desktop' }]);
  }
});

test('DSH tray keeps the browser visibility bit when toggling desktop visibility', async () => {
  for (const target of ['desktop', 'standalone', 'web']) {
    for (const [display, next] of [
      ['web', 'both'],
      ['both', 'web'],
      ['desktop', 'none'],
      ['none', 'desktop'],
    ]) {
      const result = await trayHarness(target, display);
      assert.equal(result.checked, display === 'desktop' || display === 'both');
      assert.deepEqual(result.writes, [{ id: 'main', display: next }]);
    }
  }
});
