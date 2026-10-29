"""Regress shared-field RGBA interpolation without depending on a particular DIS estimate.

Run with unittest and the same NumPy/OpenCV environment as the media worker.
The worker is loaded relative to this file, so these checks also work in a fresh checkout.
"""

import importlib.util
from pathlib import Path
import unittest

import numpy as np


WORKER_PATH = Path(__file__).resolve().parents[1] / "interpolate-character-rgba.py"
SPEC = importlib.util.spec_from_file_location("character_rgba_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def blob(dx=0, dy=0, *, alpha=224, hidden_green=False):
    image = np.zeros((32, 48, 4), dtype=np.uint8)
    if hidden_green:
        image[:, :, 1] = 255
    image[8 + dy : 20 + dy, 8 + dx : 20 + dx] = [200, 80, 40, alpha]
    # A translucent perimeter makes colour/alpha disagreement visible at the outline.
    image[8 + dy, 8 + dx : 20 + dx, 3] = 80
    image[19 + dy, 8 + dx : 20 + dx, 3] = 80
    image[8 + dy : 20 + dy, 8 + dx, 3] = 80
    image[8 + dy : 20 + dy, 19 + dx, 3] = 80
    return image


def constant_flow(image, dx, dy):
    flow = np.empty((*image.shape[:2], 2), dtype=np.float32)
    flow[:, :, 0] = dx
    flow[:, :, 1] = dy
    return flow


def translation_factory(left, right):
    left_y, left_x = np.nonzero(left[:, :, 3])
    right_y, right_x = np.nonzero(right[:, :, 3])
    dx = float(right_x.mean() - left_x.mean())
    dy = float(right_y.mean() - left_y.mean())
    return constant_flow(left, dx, dy), constant_flow(left, -dx, -dy)


def visible_bounds(image):
    ys, xs = np.nonzero(image[:, :, 3] > 32)
    if not len(xs):
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))


class SharedCharacterFlowTests(unittest.TestCase):
    def test_premultiplication_normalizes_all_channels_and_removes_hidden_rgb(self):
        image = np.array([[[255, 128, 64, 128], [0, 255, 0, 0]]], dtype=np.uint8)
        actual = worker.premultiply_rgba(image)
        self.assertEqual(actual.dtype, np.float32)
        alpha = 128 / 255
        expected = np.array([[[alpha, 128 / 255 * alpha, 64 / 255 * alpha, alpha], [0, 0, 0, 0]]])
        np.testing.assert_allclose(actual, expected, atol=1e-7)
        self.assertTrue(np.isfinite(actual).all())

    def test_shared_warp_translates_rgb_and_alpha_to_the_same_pixel(self):
        image = blob()
        premultiplied = worker.premultiply_rgba(image)
        warped = worker.warp_shared_rgba(premultiplied, constant_flow(image, 8, 4), 0.5)
        output = worker.unpremultiply_rgba(warped)
        self.assertEqual(output.dtype, np.uint8)
        self.assertEqual(visible_bounds(output), (12, 10, 24, 22))
        np.testing.assert_array_equal(output[10:22, 12:24], image[8:20, 8:20])
        self.assertEqual(int(output[:, :, 3].sum()), int(image[:, :, 3].sum()))

    def test_bidirectional_midpoint_is_one_translated_blob_instead_of_two_faded_blobs(self):
        left, right = blob(), blob(8, 4)
        forward, backward = translation_factory(left, right)
        output = worker.interpolate_premultiplied(
            worker.premultiply_rgba(left), worker.premultiply_rgba(right), forward, backward, 0.5
        )
        self.assertEqual(visible_bounds(output), (12, 10, 24, 22))
        np.testing.assert_array_equal(output[10:22, 12:24], left[8:20, 8:20])
        self.assertFalse(np.any(output[8:10, 8:20, 3]))
        self.assertFalse(np.any(output[22:24, 16:28, 3]))

    def test_fractional_translation_keeps_translucent_outline_colour_without_black_or_green_fringe(self):
        left, right = blob(hidden_green=True), blob(5, 0, hidden_green=True)
        forward, backward = translation_factory(left, right)
        output = worker.interpolate_premultiplied(
            worker.premultiply_rgba(left), worker.premultiply_rgba(right), forward, backward, 0.5
        )
        alpha = output[:, :, 3]
        edge = (alpha > 0) & (alpha < 224)
        self.assertTrue(edge.any())
        expected_colour = np.array([200, 80, 40], dtype=np.int16)
        errors = np.abs(output[:, :, :3][edge].astype(np.int16) - expected_colour)
        self.assertLessEqual(int(errors.max()), 2)
        self.assertTrue(np.all(output[:, :, :3][alpha == 0] == 0))

    def test_zero_alpha_is_finite_and_cannot_leak_hidden_green(self):
        image = np.zeros((12, 16, 4), dtype=np.uint8)
        image[:, :, :3] = [20, 255, 70]
        premultiplied = worker.premultiply_rgba(image)
        shifted = worker.warp_shared_rgba(premultiplied, constant_flow(image, 3, -2), 0.5)
        self.assertTrue(np.isfinite(shifted).all())
        output = worker.unpremultiply_rgba(shifted)
        self.assertEqual(output.dtype, np.uint8)
        self.assertFalse(np.any(output))
        zero_flow = constant_flow(image, 0, 0)
        midpoint = worker.interpolate_premultiplied(premultiplied, premultiplied, zero_flow, zero_flow, 0.5)
        self.assertFalse(np.any(midpoint))

    def test_non_loop_count_anchor_order_and_final_hold_preserve_source_bytes(self):
        images = [blob(hidden_green=True), blob(8, 4, hidden_green=True), blob(16, 0, hidden_green=True)]
        originals = [image.copy() for image in images]
        ticks = 4
        frames = list(worker.generate_frames(images, ticks, False, flow_factory=translation_factory))
        self.assertEqual(len(frames), len(images) * ticks)
        for index, image in enumerate(images):
            np.testing.assert_array_equal(frames[index * ticks], image)
            self.assertEqual(frames[index * ticks].dtype, np.uint8)
        for frame in frames[-ticks:]:
            np.testing.assert_array_equal(frame, images[-1])
        for actual, original in zip(images, originals):
            np.testing.assert_array_equal(actual, original)

    def test_loop_final_interval_moves_back_to_first_without_adding_a_duplicate_endpoint(self):
        images = [blob(hidden_green=True), blob(8, 4, hidden_green=True)]
        frames = list(worker.generate_frames(images, 4, True, flow_factory=translation_factory))
        self.assertEqual(len(frames), 8)
        np.testing.assert_array_equal(frames[0], images[0])
        np.testing.assert_array_equal(frames[4], images[1])
        self.assertEqual(visible_bounds(frames[6]), (12, 10, 24, 22))
        self.assertEqual(visible_bounds(frames[7]), (10, 9, 22, 21))
        self.assertFalse(np.array_equal(frames[-1], images[0]))
        self.assertFalse(np.array_equal(frames[-1], images[1]))

    def test_smooth_translation_has_new_intermediate_positions_between_preserved_anchors(self):
        images = [blob(), blob(8, 4)]
        frames = list(worker.generate_frames(images, 4, False, flow_factory=translation_factory))
        self.assertEqual([visible_bounds(frame) for frame in frames[:5]], [
            (8, 8, 20, 20),
            (10, 9, 22, 21),
            (12, 10, 24, 22),
            (14, 11, 26, 23),
            (16, 12, 28, 24),
        ])
        self.assertEqual(len({frame.tobytes() for frame in frames[:5]}), 5)

    def test_invalid_rgba_shapes_and_mismatched_frames_are_rejected(self):
        invalid = [
            np.zeros((8, 8), dtype=np.uint8),
            np.zeros((8, 8, 3), dtype=np.uint8),
            np.zeros((8, 8, 5), dtype=np.uint8),
            np.zeros((0, 8, 4), dtype=np.uint8),
            np.zeros((8, 0, 4), dtype=np.uint8),
        ]
        for image in invalid:
            with self.subTest(shape=image.shape):
                with self.assertRaises((TypeError, ValueError)):
                    worker.premultiply_rgba(image)
                with self.assertRaises((TypeError, ValueError)):
                    list(worker.generate_frames([blob(), image], 4, False, flow_factory=translation_factory))
        with self.assertRaises((TypeError, ValueError)):
            list(worker.generate_frames([blob(), np.zeros((16, 16, 4), dtype=np.uint8)], 4, False,
                                        flow_factory=translation_factory))

    def test_invalid_sequence_and_tick_counts_are_rejected(self):
        for ticks in [0, -1, 1.5]:
            with self.subTest(ticks=ticks):
                with self.assertRaises((TypeError, ValueError)):
                    list(worker.generate_frames([blob(), blob(8, 4)], ticks, False,
                                                flow_factory=translation_factory))
        with self.assertRaises((TypeError, ValueError)):
            list(worker.generate_frames([], 4, False, flow_factory=translation_factory))


if __name__ == "__main__":
    unittest.main()
