/** Encode imagegen's finished RGBA poses into the desktop player's video container. */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'assets/pet-packs/chatgpt-dragon');
const ffmpeg = process.argv[2] || 'ffmpeg';
const output = join(pack, 'chatgpt-dragon-animation');
mkdirSync(output, { recursive: true });
const actions = {
  白龙待机眨眼: [
    ['idle', 3],
    ['blink', 0.12],
    ['idle', 1.6],
    ['blink', 0.12],
    ['idle', 1.2],
  ],
  白龙挥手: [
    ['idle', 0.25],
    ['wave', 0.65],
    ['idle', 0.18],
    ['wave', 0.65],
    ['idle', 0.4],
  ],
  白龙轻闭双眼: [
    ['blink', 2.8],
    ['idle', 0.7],
  ],
  白龙品茶: [
    ['tea', 2.6],
    ['idle', 0.6],
  ],
};
const temporary = mkdtempSync(join(tmpdir(), 'dsh-dragon-media-'));
try {
  const run = (args) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Character media encoding failed.');
  };
  const atlas = (name, columns, rows) => {
    const path = join(pack, 'source', name + '.png');
    const header = readFileSync(path);
    const width = header.readUInt32BE(16),
      height = header.readUInt32BE(20);
    const files = [];
    for (let index = 0; index < columns * rows; index++) {
      const col = index % columns,
        row = Math.floor(index / columns);
      const x = Math.floor((col * width) / columns),
        y = Math.floor((row * height) / rows);
      const w = Math.floor(((col + 1) * width) / columns) - x;
      const h = Math.floor(((row + 1) * height) / rows) - y;
      const frame = join(temporary, name + '-' + index + '.png');
      // Extract the generated frames without painting, retouching or changing their pose.
      run(['-i', path, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', frame]);
      files.push(frame);
    }
    return files;
  };
  const walk = atlas('walk-cycle', 4, 2);
  const idleDrag = atlas('idle-drag-cycle', 4, 4);
  const turn = atlas('turn-cycle', 4, 2);
  const courtesyHair = atlas('courtesy-hair-cycle', 4, 4);
  const teaReading = atlas('tea-reading-cycle', 4, 4);
  const wingsDrag = atlas('wings-drag-cycle', 4, 4);
  const repeat = (frames, times, seconds) =>
    Array.from({ length: times }, () => frames.map((file) => [file, seconds])).flat();
  const clips = Object.entries(actions).map(([name, frames]) => ({
    name,
    y: 44,
    frames: frames.map(([pose, seconds]) => [join(pack, 'source', pose + '.png'), seconds]),
  }));
  clips.push(
    { name: '白龙待机灵动', y: 33, frames: repeat(idleDrag.slice(0, 8), 3, 0.25) },
    { name: '白龙轻快行走', y: 33, frames: [[walk[0], 0.15], ...repeat(walk, 4, 0.125), [walk[0], 0.2]] },
    { name: '白龙回首转身', y: 33, frames: turn.map((file) => [file, 0.16]) },
    { name: '白龙悬空摆尾', y: 33, frames: repeat(idleDrag.slice(8), 2, 0.125) },
    { name: '白龙提裙轻礼', y: 33, frames: courtesyHair.slice(0, 8).map((file) => [file, 0.3]) },
    { name: '白龙拂发整袖', y: 33, frames: courtesyHair.slice(8).map((file) => [file, 0.24]) },
    { name: '白龙从容抿茶', y: 33, frames: teaReading.slice(0, 8).map((file) => [file, 0.36]) },
    { name: '白龙静心阅卷', y: 33, frames: teaReading.slice(8).map((file) => [file, 0.45]) },
    { name: '白龙舒翼摆尾', y: 33, frames: wingsDrag.slice(0, 8).map((file) => [file, 0.25]) },
    { name: '白龙悬空轻扶', y: 33, frames: repeat(wingsDrag.slice(8), 3, 0.125) },
    { name: '白龙优雅颔首', y: 33, frames: [0, 1, 2, 3, 2, 1, 0].map((i) => [courtesyHair[i], 0.16]) },
  );
  for (const { name, frames, y } of clips) {
    const file = join(temporary, 'frames.txt');
    const quote = (path) => "'" + path.replaceAll("'", "'\\''") + "'";
    const lines = frames.flatMap(([path, seconds]) => ['file ' + quote(path), 'duration ' + seconds]);
    lines.push('file ' + quote(frames.at(-1)[0]));
    writeFileSync(file, lines.join('\n') + '\n');
    const encoded = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        file,
        // Keep each complete square pose; fit it to the existing body/click geometry.
        '-vf',
        `scale=-2:300:flags=lanczos,format=rgba,pad=640:360:(ow-iw)/2:${y}:color=black@0,format=yuva420p`,
        '-r',
        '24',
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-auto-alt-ref',
        '0',
        '-b:v',
        '0',
        '-crf',
        '24',
        '-an',
        join(output, name + '.webm'),
      ],
      { stdio: 'inherit' },
    );
    if (encoded.status !== 0) throw new Error('Character media encoding failed: ' + name);
    console.log('Encoded ' + name);
  }
  // The event lane must have a distinct name or handleEnded would suppress random walking.
  copyFileSync(join(output, '白龙待机灵动.webm'), join(output, '白龙事件轻语.webm'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
