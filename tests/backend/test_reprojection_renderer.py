import io
import unittest

import numpy as np
from PIL import Image

from viewer.reprojection.core import GeometryData, RenderSuperseded
from viewer.reprojection.renderer import ReprojectionRenderer


class FakePose:
    def matrix(self):
        return np.asarray(
            [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
            dtype=np.float32,
        )


class FakeImage:
    cam_from_world = FakePose()


class FakeCamera:
    width = 320
    height = 320
    model_name = "PINHOLE"
    params = np.asarray([100, 100, 160, 160], dtype=np.float64)


def geometry(xyz, rgb, token="test"):
    return GeometryData(
        xyz=np.asarray(xyz, dtype=np.float32),
        rgb=np.asarray(rgb, dtype=np.uint8),
        name="test",
        kind="point cloud",
        revision=1,
        cache_token=token,
    )


def decode(png):
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))


class ReprojectionRendererTest(unittest.TestCase):
    def setUp(self):
        self.renderer = ReprojectionRenderer(lambda stream: stream)
        self.image = FakeImage()
        self.camera = FakeCamera()

    def render(self, points, colors, radius=0, color_mode="rgb", token="test"):
        return self.renderer.render_png(
            image_id=1,
            image=self.image,
            camera=self.camera,
            geometry=geometry(points, colors, token),
            max_size=320,
            color_mode=color_mode,
            radius=radius,
            request_stream="viewer",
        )

    def test_nearest_point_wins_at_the_same_pixel(self):
        pixels = decode(self.render(
            [[0, 0, 2], [0, 0, 1]],
            [[255, 0, 0], [0, 255, 0]],
        ))
        np.testing.assert_array_equal(pixels[160, 160], [0, 255, 0])

    def test_background_matches_meshlab_gradient(self):
        pixels = decode(self.render([[0, 0, -1]], [[1, 2, 3]], radius=0))
        np.testing.assert_array_equal(pixels[0, 20], [255, 255, 255])
        np.testing.assert_array_equal(pixels[-1, 20], [116, 116, 116])

    def test_one_pixel_render_skips_large_splat_buffers(self):
        self.render([[0, 0, 1]], [[12, 34, 56]], radius=0)
        self.assertIsNone(self.renderer._splat_cache.get(("test", 1, 320, "rgb")))

    def test_supersede_cancels_only_the_current_viewer_request(self):
        request_id = self.renderer._new_render_request("viewer")
        other_request_id = self.renderer._new_render_request("other")
        self.renderer.supersede("viewer")
        with self.assertRaises(RenderSuperseded):
            self.renderer._check_render_request("viewer", request_id)
        self.renderer._check_render_request("other", other_request_id)

    def test_enlarged_splats_remain_depth_aware(self):
        pixels = decode(self.render(
            [[0, 0, 1], [0.04, 0, 2]],
            [[0, 255, 0], [255, 0, 0]],
            radius=3,
        ))
        np.testing.assert_array_equal(pixels[160, 162], [0, 255, 0])

    def test_white_mode_and_encoded_result_cache(self):
        first = self.render([[0, 0, 1]], [[12, 34, 56]], color_mode="white")
        second = self.render([[0, 0, 1]], [[12, 34, 56]], color_mode="white")
        self.assertIs(first, second)
        np.testing.assert_array_equal(decode(first)[160, 160], [255, 255, 255])


if __name__ == "__main__":
    unittest.main()
