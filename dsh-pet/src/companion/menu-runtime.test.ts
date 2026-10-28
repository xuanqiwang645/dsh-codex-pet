import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const menuSource = readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8');

test('quit menu and shutdown request are restricted to the Codex companion mode', () => {
  for (const target of ['codex', 'desktop', 'standalone', 'web']) {
    const requests: string[] = [];
    const trees: Array<Array<{ action?: string }>> = [];
    class Sprite {
      dragState = {};
      menuOpen = false;
      justDragged = false;
      animations = {};
      menuItems = [];
      stopThrow() {}
      stopMove() {}
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
      S: {
        CHAT_HOTKEY_HINT: '',
        postAction: (path: string) => {
          requests.push(path);
          return Promise.resolve(true);
        },
        displayMenuBranch: () => ({ label: '显示位置', children: [] }),
        buildMoreBranch: () => null,
        buildMenuTree: () => [],
        mountContextMenu: ({ tree }: { tree: Array<{ action?: string }> }) => {
          trees.push(tree);
          return { close() {} };
        },
      },
    });
    const sprite = new Sprite() as Sprite & { onContextMenu(event: unknown): void; onMenuAction(leaf: unknown): void };
    sprite.onContextMenu({ preventDefault() {}, clientX: 10, clientY: 10 });
    assert.equal(
      trees[0].some((item) => item.action === 'quit-app'),
      target === 'codex',
    );
    sprite.onMenuAction({ action: 'quit-app' });
    assert.deepEqual(requests, target === 'codex' ? ['/dsh-pet-7340/quit'] : []);
  }
});
