/** Keep the Codex companion's own data separate from both native Codex and DSH. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

interface CompanionApp {
  getPath(name: string): string;
  setPath(name: string, value: string): void;
  setName(name: string): void;
}

export function configureCompanion(app: CompanionApp): void {
  const root = join(app.getPath('appData'), 'DSH Codex Pet');
  const override = process.env.DSH_CODEX_PET_DATA;
  if (override && !isAbsolute(override)) throw new Error('DSH_CODEX_PET_DATA must be absolute');
  const data = override || join(root, 'data');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const profile = override ? join(data, 'chromium') : join(root, 'chromium');
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  app.setName('DSH Codex Pet');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  // Only the companion process sees this override; ~/.dsh and Codex stay intact.
  process.env.DSH_HOME = data;
  process.env.DSH_PET_COMPANION = '1';
  process.env.DSH_CODEX_PET_PROFILE = app.getPath('userData');
  const file = join(data, 'dsh-pet', 'main-config.jsonc');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({
      font: { family: 'system', size: 21, followPet: true },
      pets: [{
        id: 'main', name: '鲸鱼娘', size: 420, balanceEnabled: true,
        whisperEnabled: true, workStatusEnabled: true, fixedEnabled: false,
        display: 'desktop', position: { corner: 'bottom-right', marginX: 40, marginY: 65 },
      }],
      notificationsEnabled: false,
      voiceEnabled: false,
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
}
