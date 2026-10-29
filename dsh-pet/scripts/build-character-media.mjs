/** Encode imagegen's finished RGBA poses into the desktop player's video container. */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { detectAlphaLayout, planFrameCanvas } from './character-layout.mjs';
import { gentlePoseSequences, interpolationSettings, planInterpolation } from './character-interpolation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'assets/pet-packs/chatgpt-dragon');
const ffmpeg = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'ffmpeg';
const layoutOnly = process.argv.includes('--layout-only');
const mediaPython = process.env.DSH_MEDIA_PYTHON || 'python3';
const onlyArgument = process.argv.find((argument) => argument.startsWith('--only='));
const selectedNames = onlyArgument ? new Set(onlyArgument.slice('--only='.length).split(',')) : undefined;
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
const frameReferences = new Map();
try {
  const run = (args) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Character media encoding failed.');
  };
  const atlas = (name, columns, rows) => {
    const source = name === 'walk-cycle' ? name + '.png' : name + '-v2.png';
    const path = join(pack, 'source', source);
    const header = readFileSync(path);
    const width = header.readUInt32BE(16),
      height = header.readUInt32BE(20);
    const decoded = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        path,
        '-vf',
        'alphaextract',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ],
      { maxBuffer: width * height + 65536 },
    );
    if (decoded.status !== 0) throw new Error('Unable to read atlas alpha: ' + source + '\n' + decoded.stderr);
    const layout = planFrameCanvas(detectAlphaLayout(decoded.stdout, width, height, { columns, rows }));
    atlasLayouts.push({ source, sha256: createHash('sha256').update(header).digest('hex'), ...layout });
    if (layoutOnly) return [];
    return layout.frames.map(({ index, crop, canvas }) => {
      const [x, y, right, bottom] = crop;
      const frame = join(temporary, name + '-' + index + '.png');
      // Only crop, scale and pad the original artwork. The shared atlas scale preserves pose size.
      const filter = `crop=${right - x}:${bottom - y}:${x}:${y},scale=${canvas.scaledWidth}:${canvas.scaledHeight}:flags=lanczos,format=rgba,pad=${canvas.width}:${canvas.height}:${canvas.x}:${canvas.y}:color=black@0`;
      run(['-i', path, '-vf', filter, '-frames:v', '1', frame]);
      frameReferences.set(frame, { source, sourceFrame: index });
      return frame;
    });
  };
  const atlasLayouts = [];
  const walk = atlas('walk-cycle', 4, 2);
  const idleDrag = atlas('idle-drag-cycle', 4, 4);
  const turn = atlas('turn-cycle', 4, 2);
  const courtesyHair = atlas('courtesy-hair-cycle', 4, 4);
  const teaReading = atlas('tea-reading-cycle', 4, 4);
  const wingsDrag = atlas('wings-drag-cycle', 4, 4);
  writeFileSync(
    join(pack, 'source', 'frame-layout.json'),
    JSON.stringify({ version: 1, atlases: atlasLayouts }, null, 2) + '\n',
  );
  if (layoutOnly) {
    console.log('Validated complete figure bounds for all six atlases; wrote source/frame-layout.json.');
    process.exitCode = 0;
  } else {
    const repeat = (frames, times, seconds) =>
      Array.from({ length: times }, () => frames.map((file) => [file, seconds])).flat();
    const clips = Object.entries(actions).map(([name, frames]) => ({
      name,
      y: 44,
      frames: frames.map(([pose, seconds]) => [join(pack, 'source', pose + '.png'), seconds]),
    }));
    clips.push(
      { name: '白龙待机灵动', normalized: true, ticks: 12, loop: true, frames: repeat(idleDrag.slice(0, 8), 3, 0.25) },
      { name: '白龙轻快行走', normalized: true, ticks: 6, loop: true, frames: repeat(walk, 4, 0.125) },
      {
        name: '白龙回首转身',
        normalized: true,
        ticks: 8,
        frames: gentlePoseSequences.turn.map((index) => [turn[index], 0.16]),
      },
      { name: '白龙悬空摆尾', normalized: true, ticks: 6, loop: true, frames: repeat(idleDrag.slice(8), 2, 0.125) },
      {
        name: '白龙提裙轻礼',
        normalized: true,
        ticks: 12,
        frames: courtesyHair.slice(0, 8).map((file) => [file, 0.3]),
      },
      { name: '白龙拂发整袖', normalized: true, ticks: 12, frames: courtesyHair.slice(8).map((file) => [file, 0.24]) },
      { name: '白龙从容抿茶', normalized: true, ticks: 16, frames: teaReading.slice(0, 8).map((file) => [file, 0.36]) },
      { name: '白龙静心阅卷', normalized: true, ticks: 20, frames: teaReading.slice(8).map((file) => [file, 0.45]) },
      {
        name: '白龙舒翼摆尾',
        normalized: true,
        ticks: 12,
        frames: gentlePoseSequences.wings.map((index) => [wingsDrag[index], 0.25]),
      },
      { name: '白龙悬空轻扶', normalized: true, ticks: 12, loop: true, frames: repeat(idleDrag.slice(0, 8), 3, 0.25) },
      {
        name: '白龙优雅颔首',
        normalized: true,
        ticks: 8,
        frames: [0, 1, 2, 3, 2, 1, 0].map((i) => [courtesyHair[i], 0.16]),
      },
    );
    const timelines = selectedNames
      ? JSON.parse(readFileSync(join(pack, 'source', 'media-timeline.json'), 'utf8')).clips
      : {};
    if (selectedNames && [...selectedNames].some((name) => !clips.some((clip) => clip.name === name)))
      throw new Error('Unknown selected character clip.');
    for (const { name, frames, y, normalized, ticks, loop } of clips.filter(
      (clip) => !selectedNames || selectedNames.has(clip.name),
    )) {
      if (normalized) {
        const plan = planInterpolation(
          frames.map(([file]) => frameReferences.get(file)),
          ticks,
          loop,
        );
        const sequence = join(temporary, name);
        mkdirSync(sequence);
        const inputFrames = frames;
        inputFrames.forEach(([file], index) =>
          copyFileSync(file, join(sequence, String(index).padStart(4, '0') + '.png')),
        );
        const rawFile = join(sequence, 'shared-flow.rgba');
        const statsFile = join(sequence, 'shared-flow.json');
        const interpolated = spawnSync(
          mediaPython,
          [
            join(root, 'scripts/interpolate-character-rgba.py'),
            '--frames-dir',
            sequence,
            '--anchors',
            String(frames.length),
            '--ticks',
            String(plan.ticks),
            ...(loop ? ['--loop'] : []),
            '--output',
            rawFile,
            '--stats',
            statsFile,
          ],
          { stdio: 'inherit' },
        );
        if (interpolated.status !== 0)
          throw new Error(
            'Shared RGBA interpolation failed. Set DSH_MEDIA_PYTHON to a Python with numpy and opencv-python-headless.',
          );
        if (statSync(rawFile).size !== 640 * 360 * 4 * plan.totalFrames)
          throw new Error('Incomplete shared-flow frames: ' + name);
        run([
          '-f',
          'rawvideo',
          '-pixel_format',
          'rgba',
          '-video_size',
          '640x360',
          '-framerate',
          String(plan.fps),
          '-i',
          rawFile,
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuva420p',
          '-auto-alt-ref',
          '0',
          '-b:v',
          '0',
          '-lossless',
          '1',
          '-an',
          join(output, name + '.webm'),
        ]);
        rmSync(rawFile);
        plan.sharedFlow = JSON.parse(readFileSync(statsFile, 'utf8'));
        timelines[name] = plan;
        console.log('Shared RGBA interpolated ' + name + ' at ' + plan.fps + 'fps');
        continue;
      }
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
          // Atlas frames already share one fixed scale and feet baseline before concatenation.
          '-vf',
          normalized
            ? 'format=yuva420p'
            : `scale=-2:300:flags=lanczos,format=rgba,pad=640:360:(ow-iw)/2:${y}:color=black@0,format=yuva420p`,
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
    if (!selectedNames || selectedNames.has('白龙待机灵动')) {
      copyFileSync(join(output, '白龙待机灵动.webm'), join(output, '白龙事件轻语.webm'));
      timelines.白龙事件轻语 = timelines.白龙待机灵动;
    }
    writeFileSync(
      join(pack, 'source', 'media-timeline.json'),
      JSON.stringify({ version: 1, interpolation: interpolationSettings, clips: timelines }, null, 2) + '\n',
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
