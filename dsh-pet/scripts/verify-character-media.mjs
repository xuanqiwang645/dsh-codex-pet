/** Verify every encoded frame against its complete source figure. Usage: node scripts/verify-character-media.mjs [ffmpeg] */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { alphaComponents } from './character-layout.mjs';
import { analyzeMotionInterval, rgbaFeature, classifyContourFringe } from './character-motion-qa.mjs';
const ffmpeg = process.argv[2] || 'ffmpeg';
const pack = join(dirname(fileURLToPath(import.meta.url)), '../assets/pet-packs/chatgpt-dragon');
const layouts = JSON.parse(readFileSync(join(pack, 'source/frame-layout.json'), 'utf8')).atlases;
const timeline = JSON.parse(readFileSync(join(pack, 'source/media-timeline.json'), 'utf8'));
const width = 640,
  height = 360,
  frameBytes = width * height;
function run(args, maxBuffer = 1024 * 1024 * 100) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer });
  if (r.status !== 0) throw Error(String(r.stderr));
  return r.stdout;
}
function bounds(alpha) {
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (let i = 0; i < alpha.length; i++)
    if (alpha[i] > 32) {
      const x = i % width,
        y = Math.floor(i / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  return [left, top, right, bottom];
}
function mask(alpha) {
  const out = new Uint8Array(frameBytes);
  for (let i = 0; i < out.length; i++) out[i] = alpha[i] > 32 ? 1 : 0;
  return out;
}
function dilate(input) {
  const out = new Uint8Array(frameBytes);
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++)
      if (input[y * width + x])
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) out[(y + dy) * width + x + dx] = 1;
  return out;
}
function reference(alpha, source, index, feature) {
  const m = mask(alpha);
  return { alpha, mask: m, dilated: dilate(m), bbox: bounds(alpha), source, index, feature };
}
const sources = new Map();
const featureFilter = 'format=gbrap,premultiply=inplace=1,scale=213:120:flags=area,format=rgba';
function sourceFeature(path, filter) {
  return rgbaFeature(
    run([
      '-i',
      path,
      '-vf',
      filter + ',' + featureFilter,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]),
  );
}

for (const layout of layouts) {
  const refs = [];
  for (const frame of layout.frames) {
    const [x, y, r, b] = frame.crop,
      c = frame.canvas;
    const filter = `crop=${r - x}:${b - y}:${x}:${y},scale=${c.scaledWidth}:${c.scaledHeight}:flags=lanczos,format=rgba,pad=${c.width}:${c.height}:${c.x}:${c.y}:color=black@0,alphaextract`;
    refs.push(
      reference(
        run([
          '-i',
          join(pack, 'source', layout.source),
          '-vf',
          filter,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          'pipe:1',
        ]),
        layout.source,
        frame.index,
        sourceFeature(join(pack, 'source', layout.source), filter.replace(/,alphaextract$/, '')),
      ),
    );
  }
  sources.set(layout.source.split('-cycle')[0], refs);
}
for (const name of ['idle', 'blink', 'wave', 'tea']) {
  const filter = 'scale=-2:300:flags=lanczos,format=rgba,pad=640:360:(ow-iw)/2:44:color=black@0,alphaextract';
  sources.set(name, [
    reference(
      run([
        '-i',
        join(pack, 'source', name + '.png'),
        '-vf',
        filter,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ]),
      name + '.png',
      0,
    ),
  ]);
}
const pick = (key, start = 0, end) => sources.get(key).slice(start, end);
const mappings = {
  白龙待机眨眼: [...pick('idle'), ...pick('blink')],
  白龙挥手: [...pick('idle'), ...pick('wave')],
  白龙轻闭双眼: [...pick('blink'), ...pick('idle')],
  白龙品茶: [...pick('tea'), ...pick('idle')],
  白龙待机灵动: pick('idle-drag', 0, 8),
  白龙事件轻语: pick('idle-drag', 0, 8),
  白龙轻快行走: pick('walk'),
  白龙回首转身: pick('turn'),
  白龙悬空摆尾: pick('idle-drag', 8),
  白龙提裙轻礼: pick('courtesy-hair', 0, 8),
  白龙拂发整袖: pick('courtesy-hair', 8),
  白龙从容抿茶: pick('tea-reading', 0, 8),
  白龙静心阅卷: pick('tea-reading', 8),
  白龙舒翼摆尾: pick('wings-drag', 0, 8),
  白龙悬空轻扶: pick('idle-drag', 0, 8),
  白龙优雅颔首: pick('courtesy-hair', 0, 4),
};
function iou(a, b) {
  let intersection = 0,
    union = 0;
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      const i = y * width + x,
        aa = a[i] > 32,
        bb = b[i];
      if (aa && bb) intersection++;
      if (aa || bb) union++;
    }
  return intersection / union;
}
const animations = [],
  failures = [],
  warnings = [];
const nearbyPixels = [];
for (let y = -16; y <= 16; y++)
  for (let x = -16; x <= 16; x++) if (x * x + y * y <= 256) nearbyPixels.push({ x, y, distance: Math.hypot(x, y) });
nearbyPixels.sort((a, b) => a.distance - b.distance);
function contourDetails(alpha, labels, main, components) {
  return components
    .filter((component) => component.id !== main.id && component.pixels > 8)
    .map((component) => {
      let maxAlpha = 0,
        nearestBodyDistance = 17,
        farthestBodyDistance = 0;
      for (let y = component.bounds[1]; y < component.bounds[3]; y++)
        for (let x = component.bounds[0]; x < component.bounds[2]; x++) {
          const pixel = y * width + x;
          if (labels[pixel] !== component.id) continue;
          maxAlpha = Math.max(maxAlpha, alpha[pixel]);
          let distance = 17;
          for (const offset of nearbyPixels) {
            const nx = x + offset.x,
              ny = y + offset.y;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === main.id) {
              distance = offset.distance;
              break;
            }
          }
          nearestBodyDistance = Math.min(nearestBodyDistance, distance);
          farthestBodyDistance = Math.max(farthestBodyDistance, distance);
        }
      return {
        pixels: component.pixels,
        bounds: component.bounds,
        maxAlpha,
        nearestBodyDistance,
        farthestBodyDistance,
      };
    });
}
const allReferences = [...sources.values()].flat();
const getReference = (descriptor) => {
  const ref = allReferences.find((ref) => ref.source === descriptor.source && ref.index === descriptor.sourceFrame);
  if (!ref) throw Error('Unknown timeline source anchor ' + JSON.stringify(descriptor));
  return ref;
};
const alphaArea = (alpha) => {
  let n = 0;
  for (const value of alpha) if (value > 32) n++;
  return n;
};
const footArea = (alpha, baseline) => {
  let n = 0;
  for (let y = Math.max(0, baseline - 20); y < Math.min(height, baseline + 3); y++)
    for (let x = 0; x < width; x++) if (alpha[y * width + x] > 32) n++;
  return n;
};
const featuresFromRaw = (raw) => {
  const size = 213 * 120 * 4;
  if (raw.length % size) throw Error('Invalid motion feature geometry');
  return Array.from({ length: raw.length / size }, (_, i) => rgbaFeature(raw.subarray(i * size, (i + 1) * size)));
};
for (const file of readdirSync(join(pack, 'chatgpt-dragon-animation'))
  .filter((file) => file.endsWith('.webm'))
  .sort()) {
  const name = file.slice(0, -5),
    refs = mappings[name],
    plan = timeline.clips[name];
  if (!refs) throw Error('Missing source mapping ' + name);
  const path = join(pack, 'chatgpt-dragon-animation', file),
    bytes = readFileSync(path);
  const raw = run([
    '-c:v',
    'libvpx-vp9',
    '-i',
    path,
    '-vf',
    'alphaextract',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    'pipe:1',
  ]);
  if (raw.length % frameBytes) throw Error('Invalid decoded frame geometry ' + file);
  const count = raw.length / frameBytes,
    frames = [],
    hashes = new Set(),
    anchorMap = new Map(plan?.anchors.map((anchor) => [anchor.frame, anchor]) || []);
  if (plan && count !== plan.totalFrames)
    failures.push({ animation: file, reason: 'frame-count', expected: plan.totalFrames, actual: count });
  const features = plan
    ? featuresFromRaw(
        run(['-c:v', 'libvpx-vp9', '-i', path, '-vf', featureFilter, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']),
      )
    : [];
  if (plan && features.length !== count) throw Error('Motion feature count mismatch ' + file);
  const intervals = [];
  if (plan)
    for (const interval of plan.intervals) {
      const left = getReference(interval.left),
        right = getReference(interval.right);
      const samples = features.slice(interval.startFrame, Math.min(interval.endFrame + 1, count));
      if (interval.endFrame === count) samples.push(right.feature);
      const quality = analyzeMotionInterval({
        features: samples,
        leftFeature: left.feature,
        rightFeature: right.feature,
      });
      intervals.push({ ...interval, ...quality });
      if (!quality.passed) failures.push({ animation: file, reason: 'motion-continuity', ...interval, ...quality });
    }
  for (let index = 0; index < count; index++) {
    const alpha = raw.subarray(index * frameBytes, (index + 1) * frameBytes),
      bbox = bounds(alpha);
    const anchor = anchorMap.get(index),
      interval = plan?.intervals[Math.floor(index / plan.ticks)];
    const kind = anchor ? 'anchor' : plan ? 'interpolated' : 'held';
    const left = interval ? getReference(interval.left) : undefined,
      right = interval ? getReference(interval.right) : undefined;
    let best = anchor ? getReference(anchor) : undefined,
      score = best ? iou(alpha, best.mask) : -1;
    if (!best)
      for (const ref of plan ? [left, right] : refs) {
        const value = iou(alpha, ref.mask);
        if (value > score) {
          score = value;
          best = ref;
        }
      }
    const { labels, components } = alphaComponents(alpha, width, height);
    components.sort((a, b) => b.pixels - a.pixels);
    const main = components[0];
    if (!main) throw Error('Empty encoded character frame ' + file + ' ' + index);
    const area = components.reduce((sum, part) => sum + part.pixels, 0),
      mainShare = main.pixels / area;
    let unmatchedHighAlphaPixels = 0,
      unmatchedSecondaryHighAlphaPixels = 0,
      maxSecondaryPixels = 0;
    for (let i = 0; i < alpha.length; i++)
      if (alpha[i] > 32 && !best.dilated[i]) {
        unmatchedHighAlphaPixels++;
        if (labels[i] !== main.id) unmatchedSecondaryHighAlphaPixels++;
      }
    for (const part of components.slice(1)) maxSecondaryPixels = Math.max(maxSecondaryPixels, part.pixels);
    const bboxDelta = Math.max(...bbox.map((value, i) => Math.abs(value - best.bbox[i])));
    const row = {
      index,
      kind,
      visibleBounds: bbox,
      source: best.source,
      sourceFrame: best.index,
      sourceVisibleBounds: best.bbox,
      maskIoU: Number(score.toFixed(6)),
      bboxDelta,
      maxSecondaryPixels,
      mainShare: Number(mainShare.toFixed(8)),
      unmatchedHighAlphaPixels,
      unmatchedSecondaryHighAlphaPixels,
      transparentMargins: { top: bbox[1], bottom: height - bbox[3] },
    };
    const reasons = [],
      warningReasons = [];
    let borderAlphaMaximum = 0;
    for (let x = 0; x < width; x++)
      borderAlphaMaximum = Math.max(borderAlphaMaximum, alpha[x], alpha[(height - 1) * width + x]);
    for (let y = 0; y < height; y++)
      borderAlphaMaximum = Math.max(borderAlphaMaximum, alpha[y * width], alpha[y * width + width - 1]);
    row.borderAlphaMaximum = borderAlphaMaximum;
    if (bbox[1] < 20 || height - bbox[3] < 20) reasons.push('canvas-clearance');
    if (borderAlphaMaximum > 3) reasons.push('transparent-background');
    if (kind !== 'interpolated') {
      if (score < 0.985 || bboxDelta > 2 || unmatchedHighAlphaPixels > 3 || unmatchedSecondaryHighAlphaPixels > 3)
        reasons.push('source-anchor-mismatch');
    } else {
      const union = [
        Math.min(left.bbox[0], right.bbox[0]),
        Math.min(left.bbox[1], right.bbox[1]),
        Math.max(left.bbox[2], right.bbox[2]),
        Math.max(left.bbox[3], right.bbox[3]),
      ];
      const expectedMin = Math.min(alphaArea(left.alpha), alphaArea(right.alpha)),
        expectedMax = Math.max(alphaArea(left.alpha), alphaArea(right.alpha));
      const baseline = Math.max(left.bbox[3], right.bbox[3]);
      row.alphaArea = area;
      row.anchorAreaRange = [expectedMin, expectedMax];
      row.footCoverage =
        footArea(alpha, baseline) /
        Math.max(1, Math.min(footArea(left.alpha, baseline), footArea(right.alpha, baseline)));
      // A curved interpolated hair tip can gain a handful of very faint AA samples.
      // Measure that fringe explicitly; an opaque excursion or visible fragment still fails.
      let outsideUnionPixels = 0,
        outsideUnionMaximumAlpha = 0;
      for (let pixel = 0; pixel < alpha.length; pixel++) {
        if (alpha[pixel] <= 32) continue;
        const x = pixel % width,
          y = Math.floor(pixel / width);
        if (x < union[0] - 3 || y < union[1] - 3 || x >= union[2] + 3 || y >= union[3] + 3) {
          outsideUnionPixels++;
          outsideUnionMaximumAlpha = Math.max(outsideUnionMaximumAlpha, alpha[pixel]);
        }
      }
      row.outsideUnionPixels = outsideUnionPixels;
      row.outsideUnionMaximumAlpha = outsideUnionMaximumAlpha;
      if (outsideUnionPixels > 8 || outsideUnionMaximumAlpha > 64) {
        if (outsideUnionPixels <= 32 && outsideUnionMaximumAlpha <= 160)
          warningReasons.push('translucent-contour-excursion');
        else reasons.push('interpolation-bounds');
      }
      if (area < expectedMin * 0.85 || area > expectedMax * 1.15) reasons.push('interpolation-coverage');
      if (mainShare < 0.999 || maxSecondaryPixels > 8) {
        row.contourComponents = contourDetails(alpha, labels, main, components);
        if (
          mainShare >= 0.995 &&
          row.contourComponents.every((component) => classifyContourFringe({ ...component, mainShare }) === 'warning')
        )
          warningReasons.push('translucent-contour-fringe');
        else reasons.push('isolated-alpha-fragment');
      }
      if (row.footCoverage < 0.5) reasons.push('missing-feet');
    }
    if (reasons.length) failures.push({ animation: file, reasons, ...row });
    if (warningReasons.length) warnings.push({ animation: file, reasons: warningReasons, ...row });
    frames.push(row);
    hashes.add(createHash('sha256').update(alpha).digest('hex'));
  }
  const activeIntervals = intervals.filter((interval) => !interval.isStatic);
  const strictFrames = frames.filter((frame) => frame.kind !== 'interpolated');
  const animation = {
    name: file,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    canvas: [width, height],
    transparent: true,
    sampledFrames: count,
    allFramesChecked: true,
    fps: plan?.fps || 24,
    interpolation: plan ? 'shared-RGBA-optical-flow' : 'source-holds',
    anchorCount: plan?.anchors.length || 0,
    distinctDecodedAlphaFrames: hashes.size,
    visibleBounds: [
      Math.min(...frames.map((frame) => frame.visibleBounds[0])),
      Math.min(...frames.map((frame) => frame.visibleBounds[1])),
      Math.max(...frames.map((frame) => frame.visibleBounds[2])),
      Math.max(...frames.map((frame) => frame.visibleBounds[3])),
    ],
    minMaskIoU: Math.min(...strictFrames.map((frame) => frame.maskIoU)),
    maxBboxDelta: Math.max(...strictFrames.map((frame) => frame.bboxDelta)),
    maxSecondaryPixels: Math.max(...frames.map((frame) => frame.maxSecondaryPixels)),
    minTransparentTopMargin: Math.min(...frames.map((frame) => frame.transparentMargins.top)),
    minTransparentBottomMargin: Math.min(...frames.map((frame) => frame.transparentMargins.bottom)),
    activeIntervalCount: activeIntervals.length,
    newIntermediatePoses: activeIntervals.reduce((sum, interval) => sum + interval.newIntermediatePoses, 0),
    maxMotionStepRatio: Math.max(0, ...activeIntervals.map((interval) => interval.maxStepToEndpointRatio)),
    intervals,
    frames,
  };
  animations.push(animation);
  console.log(
    file,
    'frames',
    count,
    'anchorIoU',
    animation.minMaskIoU,
    'new poses',
    animation.newIntermediatePoses,
    'max motion step',
    animation.maxMotionStepRatio,
    'failures',
    failures.filter((failure) => failure.animation === file).length,
    'warnings',
    warnings.filter((warning) => warning.animation === file).length,
  );
}
const report = {
  source: 'built-in image_gen; connected alpha figure extraction and shared RGBA optical-flow interpolation',
  sourcePoseCount: 84,
  animationCount: animations.length,
  alphaThreshold: 32,
  canvas: [width, height],
  allEncodedFramesChecked: true,
  totalFrames: animations.reduce((sum, animation) => sum + animation.sampledFrames, 0),
  interpolation: timeline.interpolation,
  alphaComparison: {
    minimumAnchorMaskIoU: 0.985,
    maximumAnchorBboxDeltaPixels: 2,
    sourceMaskHaloPixels: 2,
    maximumUnmatchedAnchorHighAlphaPixels: 3,
    minimumInterpolatedMainShare: 0.999,
    maximumInterpolatedSecondaryComponentPixels: 8,
    minimumFootCoverage: 0.5,
    maximumFaintBoundsFringePixels: 8,
    maximumFaintBoundsFringeAlpha: 64,
    contourWarningLimits: {
      maximumComponentPixels: 128,
      maximumAlpha: 160,
      maximumDistanceToMainBodyPixels: 16,
      minimumMainBodyShare: 0.995,
      maximumBoundsExcursionPixels: 32,
    },
  },
  failures,
  warnings,
  animations,
};
writeFileSync(join(pack, 'media-validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log('TOTAL', report.totalFrames, 'FAILURES', failures.length, 'WARNINGS', warnings.length);
if (failures.length) process.exitCode = 1;
