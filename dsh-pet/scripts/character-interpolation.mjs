/** All premultiplied RGBA channels use the same bidirectional DIS optical-flow mapping. */
export const interpolationSettings = {
  fps: 48,
  method: 'bidirectional-DIS-shared-premultiplied-RGBA',
  preset: 'MEDIUM',
  finestScale: 0,
  losslessEncoding: true,
  inverseMapIterations: 4,
  allChannelsShareMapping: true,
  buildDependencies: ['numpy', 'opencv-python-headless'],
  dependenciesIncludedInApp: false,
};

export const gentlePoseSequences = {
  turn: [0, 1, 0, 7, 0, 1, 0, 0],
  wings: [0, 1, 5, 6, 7, 6, 5, 0],
};

export function planInterpolation(references, ticks, loop = false) {
  if (!Number.isInteger(ticks) || ticks < 3 || references.length < 2)
    throw new Error('Interpolation needs multiple anchors and at least three output frames per interval.');
  const fps = interpolationSettings.fps;
  const anchors = references.map((reference, index) => ({ frame: index * ticks, ...reference }));
  return {
    fps,
    ticks,
    inputFrameRate: `${fps}/${ticks}`,
    totalFrames: references.length * ticks,
    loop,
    anchors,
    intervals: references.map((left, index) => ({
      startFrame: index * ticks,
      endFrame: (index + 1) * ticks,
      left,
      right: references[index + 1] || (loop ? references[0] : left),
    })),
  };
}
