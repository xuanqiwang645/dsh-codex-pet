/** Normalize already premultiplied, area-downsampled RGBA bytes for motion comparisons. */
export function rgbaFeature(rgba) {
  if (!(rgba instanceof Uint8Array) || !rgba.length || rgba.length % 4) {
    throw new TypeError('Motion input must contain complete RGBA pixels.');
  }
  return Float32Array.from(rgba, (value) => value / 255);
}

/** Keep bounded, translucent contour fringes visible as warnings; substantial fragments still fail. */
export function classifyContourFringe({ pixels, maxAlpha, farthestBodyDistance, mainShare }) {
  return pixels <= 128 && maxAlpha <= 160 && farthestBodyDistance <= 16 && mainShare >= 0.995 ? 'warning' : 'failure';
}

/** Mean absolute difference, including alpha and the premultiplied colour channels. */
export function featureDifference(left, right) {
  if (
    !(left instanceof Float32Array) ||
    !(right instanceof Float32Array) ||
    !left.length ||
    left.length !== right.length
  ) {
    throw new TypeError('Motion features must be nonempty Float32Arrays of equal length.');
  }
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  if (!Number.isFinite(total)) throw new TypeError('Motion features must contain finite values.');
  return total / left.length;
}

/**
 * Check one source-anchor interval, rather than treating codec noise or repeated frames as new poses.
 * `features` includes both decoded anchors; the caller may append a source endpoint for a loop tail.
 * Near-duplicate runs count adjacent near-duplicate steps, not the number of frames in the run.
 */
export function analyzeMotionInterval({ features, leftFeature, rightFeature, noiseFloor = 0.0004 }) {
  if (!Array.isArray(features) || features.length < 2) {
    throw new TypeError('A motion interval needs both endpoint frames.');
  }
  if (!Number.isFinite(noiseFloor) || noiseFloor < 0) throw new TypeError('Invalid motion noise floor.');

  const endpointDifference = featureDifference(leftFeature, rightFeature);
  for (const feature of features) featureDifference(feature, leftFeature);
  const isStatic = endpointDifference <= noiseFloor * 4;
  const duplicateThreshold = Math.max(noiseFloor, endpointDifference * 0.01);
  const newPoseThreshold = Math.max(noiseFloor, endpointDifference * 0.1);
  let maxStepDifference = 0,
    nearDuplicateRun = 0,
    longestNearDuplicateRun = 0;
  for (let index = 1; index < features.length; index++) {
    const difference = featureDifference(features[index - 1], features[index]);
    maxStepDifference = Math.max(maxStepDifference, difference);
    nearDuplicateRun = difference <= duplicateThreshold ? nearDuplicateRun + 1 : 0;
    longestNearDuplicateRun = Math.max(longestNearDuplicateRun, nearDuplicateRun);
  }

  const intermediatePoses = [];
  for (const feature of features.slice(1, -1)) {
    if (
      featureDifference(feature, leftFeature) > newPoseThreshold &&
      featureDifference(feature, rightFeature) > newPoseThreshold &&
      intermediatePoses.every((previous) => featureDifference(feature, previous) > duplicateThreshold)
    ) {
      intermediatePoses.push(feature);
    }
  }

  const stride = features.length - 1;
  const requiredIntermediatePoses = isStatic ? 0 : stride >= 7 ? 2 : 1;
  const reasons = [];
  // Anchor identity/order is also checked by the caller's strict source-mask comparison.
  // This catches a reversed or unrelated interval before evaluating its apparent smoothness.
  const anchorTolerance = Math.max(noiseFloor * 4, endpointDifference * 0.01);
  if (
    featureDifference(features[0], leftFeature) > anchorTolerance ||
    featureDifference(features.at(-1), rightFeature) > anchorTolerance
  ) {
    reasons.push('endpoint-frame-mismatch');
  }
  if (!isStatic) {
    if (intermediatePoses.length < requiredIntermediatePoses) reasons.push('too-few-intermediate-poses');
    if (maxStepDifference > endpointDifference * 0.6 + noiseFloor * 2) reasons.push('abrupt-motion-step');
    if (longestNearDuplicateRun > 2) reasons.push('repeated-motion-frames');
  }
  return {
    isStatic,
    endpointDifference,
    newIntermediatePoses: intermediatePoses.length,
    maxStepToEndpointRatio: endpointDifference ? maxStepDifference / endpointDifference : 0,
    longestNearDuplicateRun,
    requiredIntermediatePoses,
    passed: reasons.length === 0,
    reasons,
  };
}
