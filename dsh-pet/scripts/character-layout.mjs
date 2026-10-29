/** Find complete figures in a transparent atlas without assuming equal cell boundaries. */
export function alphaComponents(alpha, width, height, threshold = 32) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Invalid atlas dimensions.');
  }
  if (alpha.length !== width * height) throw new Error('Atlas alpha byte count does not match its dimensions.');
  const labels = new Uint32Array(alpha.length);
  const queue = new Uint32Array(alpha.length);
  const components = [];
  for (let seed = 0; seed < alpha.length; seed++) {
    if (alpha[seed] <= threshold || labels[seed]) continue;
    const id = components.length + 1;
    let head = 0,
      tail = 1,
      left = width,
      top = height,
      right = 0,
      bottom = 0;
    queue[0] = seed;
    labels[seed] = id;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width,
        y = Math.floor(index / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const next = ny * width + nx;
          if (alpha[next] > threshold && !labels[next]) {
            labels[next] = id;
            queue[tail++] = next;
          }
        }
      }
    }
    components.push({ id, pixels: tail, bounds: [left, top, right, bottom] });
  }
  return { labels, components };
}

const contains = (outer, inner) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
const intersects = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const expand = (bounds, padding) => [
  bounds[0] - padding,
  bounds[1] - padding,
  bounds[2] + padding,
  bounds[3] + padding,
];

/**
 * Significant detached parts require an explicit, reviewed ROI instead of guessed ownership.
 * reviewedRegions are complete figure rectangles [left, top, right, bottom], in playback order.
 */
export function detectAlphaLayout(alpha, width, height, options) {
  const { columns, rows, threshold = 32, padding = 2, reviewedRegions, noisePixels = 3 } = options;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error('Invalid atlas frame count.');
  }
  if (!Number.isInteger(padding) || padding < 1) throw new Error('An antialias safety margin is required.');
  const expected = columns * rows;
  const { labels, components } = alphaComponents(alpha, width, height, threshold);
  const significant = components.filter((part) => part.pixels > noisePixels);
  const minBodyArea = Math.max(12, Math.floor((width * height * 0.025) / expected));
  const minBodyHeight = Math.max(3, (height / rows) * 0.3);
  const bodies = significant.filter(
    (part) => part.pixels >= minBodyArea && part.bounds[3] - part.bounds[1] >= minBodyHeight,
  );
  let groups;
  if (reviewedRegions) {
    if (reviewedRegions.length !== expected) throw new Error(`Expected ${expected} reviewed frame regions.`);
    groups = reviewedRegions.map((region, index) => {
      if (region.length !== 4 || !region.every(Number.isInteger) || region[0] >= region[2] || region[1] >= region[3]) {
        throw new Error(`Invalid reviewed region ${index}.`);
      }
      const parts = significant.filter((part) => intersects(region, part.bounds));
      if (!parts.length || parts.some((part) => !contains(region, part.bounds))) {
        throw new Error(`Reviewed region ${index} cuts a connected alpha component.`);
      }
      if (parts.filter((part) => bodies.includes(part)).length !== 1) {
        throw new Error(`Reviewed region ${index} must contain exactly one complete figure.`);
      }
      return parts;
    });
  } else {
    if (bodies.length !== expected) {
      throw new Error(`Expected ${expected} separate figures, found ${bodies.length}; review or regenerate the atlas.`);
    }
    // Row order is determined by figure centres, never the old equal-grid cut lines.
    const ordered = [...bodies].sort((a, b) => a.bounds[1] + a.bounds[3] - b.bounds[1] - b.bounds[3]);
    const sorted = [];
    for (let row = 0; row < rows; row++) {
      const figures = ordered.slice(row * columns, (row + 1) * columns).sort((a, b) => a.bounds[0] - b.bounds[0]);
      const centresY = figures.map((part) => (part.bounds[1] + part.bounds[3]) / 2);
      if (Math.max(...centresY) - Math.min(...centresY) > (height / rows) * 0.6) {
        throw new Error('Figure row order is ambiguous; supply reviewed frame regions.');
      }
      for (let column = 1; column < figures.length; column++) {
        const previous = figures[column - 1].bounds,
          current = figures[column].bounds;
        if ((current[0] + current[2] - previous[0] - previous[2]) / 2 < (width / columns) * 0.4) {
          throw new Error('Figure column order is ambiguous; supply reviewed frame regions.');
        }
      }
      sorted.push(...figures);
    }
    // A disconnected detail inside a broad wing/tail rectangle could belong to a neighbour.
    // Do not guess its owner; reviewedRegions can explicitly group genuine detached accessories.
    groups = sorted.map((body) => [body]);
  }
  const owners = new Map();
  for (const [index, parts] of groups.entries()) {
    for (const part of parts) {
      if (owners.has(part.id)) throw new Error('Reviewed frame regions overlap the same figure detail.');
      owners.set(part.id, index);
    }
  }
  const frames = groups.map((parts, index) => {
    const bounds = [
      Math.min(...parts.map((part) => part.bounds[0])),
      Math.min(...parts.map((part) => part.bounds[1])),
      Math.max(...parts.map((part) => part.bounds[2])),
      Math.max(...parts.map((part) => part.bounds[3])),
    ];
    const crop = expand(bounds, padding);
    if (!contains([0, 0, width, height], crop)) {
      throw new Error(`Figure ${index} touches the source edge or lacks its antialias margin.`);
    }
    const foreign = new Map();
    for (let y = crop[1]; y < crop[3]; y++) {
      for (let x = crop[0]; x < crop[2]; x++) {
        const id = labels[y * width + x];
        if (id && owners.get(id) !== index) foreign.set(id, (foreign.get(id) || 0) + 1);
      }
    }
    // A tiny neighbour shoe is still contamination even when below the body threshold.
    for (const [id, pixels] of foreign) {
      if (pixels > noisePixels || owners.has(id))
        throw new Error(`Figure ${index} crop contains an unassigned or neighbouring alpha component.`);
    }
    return {
      index,
      bounds,
      crop,
      pixels: parts.reduce((sum, part) => sum + part.pixels, 0),
      componentIds: parts.map((part) => part.id),
    };
  });
  // A detached visible part outside all extracted figures must not silently disappear.
  if (significant.some((part) => !owners.has(part.id))) {
    throw new Error('Atlas contains an unassigned visible component; supply reviewed regions or regenerate it.');
  }
  return { width, height, columns, rows, threshold, padding, frames };
}

/** Use one scale for the whole atlas and align every figure's bottom to the same baseline. */
export function planFrameCanvas(
  layout,
  { width = 640, height = 360, feetY = 330, maxFigureHeight = 300, maxFigureWidth = 440 } = {},
) {
  const maxHeight = Math.max(...layout.frames.map((frame) => frame.bounds[3] - frame.bounds[1]));
  const maxWidth = Math.max(...layout.frames.map((frame) => frame.bounds[2] - frame.bounds[0]));
  const scale = Math.min(maxFigureHeight / maxHeight, maxFigureWidth / maxWidth);
  const frames = layout.frames.map((frame) => {
    const [left, top, right, bottom] = frame.crop;
    const scaledWidth = Math.max(2, Math.round(((right - left) * scale) / 2) * 2);
    const scaledHeight = Math.max(2, Math.round(((bottom - top) * scale) / 2) * 2);
    const x = Math.floor((width - scaledWidth) / 2);
    const y = feetY - Math.round((frame.bounds[3] - top) * scale);
    if (x < 0 || y < 0 || x + scaledWidth > width || y + scaledHeight > height)
      throw new Error('Normalized figure exceeds the player canvas.');
    return { ...frame, canvas: { width, height, scaledWidth, scaledHeight, x, y, feetY } };
  });
  return { ...layout, scale, frames };
}
