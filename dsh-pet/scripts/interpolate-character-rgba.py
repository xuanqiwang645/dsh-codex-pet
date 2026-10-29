"""Build-time DIS interpolation. Requires numpy and opencv-python-headless; no app dependency."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def validate_rgba(image):
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 4:
        raise ValueError("Expected a uint8 RGBA image.")
    if image.shape[0] < 1 or image.shape[1] < 1:
        raise ValueError("An RGBA image cannot be empty.")


def premultiply_rgba(image):
    validate_rgba(image)
    output = image.astype(np.float32) / 255.0
    output[:, :, :3] *= output[:, :, 3:4]
    return output


def unpremultiply_rgba(image):
    if not isinstance(image, np.ndarray) or image.ndim != 3 or image.shape[2] != 4 or not np.isfinite(image).all():
        raise ValueError("Expected finite premultiplied RGBA data.")
    alpha = np.clip(image[:, :, 3:4], 0, 1)
    rgb = np.divide(image[:, :, :3], alpha, out=np.zeros_like(image[:, :, :3]), where=alpha > 1 / 255)
    return np.rint(np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2) * 255).astype(np.uint8)


def warp_shared_rgba(image, flow, fraction):
    if image.ndim != 3 or image.shape[2] != 4 or flow.shape != (*image.shape[:2], 2):
        raise ValueError("The motion field must match all four RGBA channels.")
    if not 0 <= fraction <= 1 or not np.isfinite(image).all() or not np.isfinite(flow).all():
        raise ValueError("Invalid motion field or interpolation fraction.")
    height, width = image.shape[:2]
    xy = np.stack(np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32)), axis=-1)
    mapping = xy - fraction * flow
    # Flow is defined on source coordinates; solve the inverse map at the target time.
    for _ in range(4):
        sampled = cv2.remap(flow, mapping[:, :, 0], mapping[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        mapping = xy - fraction * sampled
    return cv2.remap(image, mapping[:, :, 0], mapping[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def interpolate_premultiplied(left, right, forward, backward, fraction):
    if left.shape != right.shape:
        raise ValueError("Source RGBA frame dimensions differ.")
    first = warp_shared_rgba(left, forward, fraction)
    second = warp_shared_rgba(right, backward, 1 - fraction)
    return unpremultiply_rgba(first * (1 - fraction) + second * fraction)


def compute_bidirectional(left, right):
    first = cv2.cvtColor(np.clip(premultiply_rgba(left)[:, :, :3] * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    second = cv2.cvtColor(np.clip(premultiply_rgba(right)[:, :, :3] * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    estimator = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    estimator.setFinestScale(0)
    forward = estimator.calc(first, second, None)
    backward = estimator.calc(second, first, None)
    return forward, backward


def generate_frames(images, ticks, loop, flow_factory=compute_bidirectional):
    if not isinstance(ticks, int) or ticks < 3 or len(images) < 2:
        raise ValueError("Interpolation requires multiple anchors and at least three frames per interval.")
    for image in images:
        validate_rgba(image)
        if image.shape != images[0].shape:
            raise ValueError("Source RGBA frame dimensions differ.")
    fingerprints = [hashlib.sha256(image.tobytes()).digest() for image in images]
    premultiplied = [premultiply_rgba(image) for image in images]
    flow_cache = {}
    for index, image in enumerate(images):
        next_index = index + 1 if index + 1 < len(images) else 0 if loop else index
        yield image.copy()  # Preserve every source anchor exactly, including its soft alpha edge.
        if fingerprints[index] == fingerprints[next_index]:
            for _ in range(ticks - 1):
                yield image.copy()
            continue
        key = (fingerprints[index], fingerprints[next_index])
        if key not in flow_cache:
            flow_cache[key] = flow_factory(image, images[next_index])
        forward, backward = flow_cache[key]
        for step in range(1, ticks):
            yield interpolate_premultiplied(premultiplied[index], premultiplied[next_index], forward, backward, step / ticks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames-dir", required=True, type=Path)
    parser.add_argument("--anchors", required=True, type=int)
    parser.add_argument("--ticks", required=True, type=int)
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--stats", required=True, type=Path)
    arguments = parser.parse_args()
    cv2.setNumThreads(2)
    images = []
    for index in range(arguments.anchors):
        path = arguments.frames_dir / f"{index:04d}.png"
        image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if image is None or image.ndim != 3 or image.shape[2] != 4:
            raise ValueError(f"Unable to load complete RGBA source frame {index}.")
        images.append(cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA))
    count = 0
    with arguments.output.open("wb") as output:
        for image in generate_frames(images, arguments.ticks, arguments.loop):
            output.write(image.tobytes())
            count += 1
    report = {
        "method": "bidirectional-DIS-shared-premultiplied-RGBA",
        "opencvVersion": cv2.__version__,
        "preset": "MEDIUM",
        "finestScale": 0,
        "inverseMapIterations": 4,
        "sourceAnchors": len(images),
        "frames": count,
        "ticks": arguments.ticks,
        "loop": arguments.loop,
        "canvas": [images[0].shape[1], images[0].shape[0]],
        "allChannelsShareMapping": True,
        "sourceAnchorsPreserved": True,
    }
    arguments.stats.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Shared RGBA DIS: {len(images)} anchors -> {count} frames.")


if __name__ == "__main__":
    main()
