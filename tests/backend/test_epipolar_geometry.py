import unittest

import numpy as np

from viewer.geometry.epipolar import (
    PoseNeighborIndex,
    calibration_matrix,
    fundamental_matrix,
)


class FakePose:
    def __init__(self, translation):
        self.translation = translation

    def matrix(self):
        return np.asarray([
            [1, 0, 0, self.translation[0]],
            [0, 1, 0, self.translation[1]],
            [0, 0, 1, self.translation[2]],
        ], dtype=np.float64)


class FakeImage:
    def __init__(self, translation):
        self.cam_from_world = FakePose(translation)


class FakeCamera:
    def __init__(self, model_name="PINHOLE"):
        self.model_name = model_name
        self.params = np.asarray([100, 120, 50, 60], dtype=np.float64)


class EpipolarGeometryTest(unittest.TestCase):
    def test_pose_neighbors_prefer_similarly_oriented_nearby_camera(self):
        index = PoseNeighborIndex(
            image_ids=[1, 2, 3, 4],
            centers=[[0, 0, 0], [0.2, 0, 0], [0.1, 0, 0], [3, 0, 0]],
            forward_directions=[[0, 0, 1], [0, 0, 1], [0, 0, -1], [0, 0, 1]],
        )
        self.assertEqual(index.candidates(1, limit=3), [2, 4, 3])

    def test_pose_neighbors_exclude_duplicate_centers_and_unknown_images(self):
        index = PoseNeighborIndex(
            image_ids=[1, 2, 3],
            centers=[[0, 0, 0], [0, 0, 0], [1, 0, 0]],
            forward_directions=[[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        )
        self.assertEqual(index.candidates(1, limit=32), [3])
        self.assertEqual(index.candidates(999, limit=32), [])

    def test_horizontal_baseline_preserves_scanline(self):
        camera = FakeCamera()
        matrix = fundamental_matrix(
            FakeImage([0, 0, 0]), camera,
            FakeImage([-1, 0, 0]), camera,
        )
        point1 = np.asarray([30, 45, 1], dtype=np.float64)
        point2 = np.asarray([80, 45, 1], dtype=np.float64)
        self.assertAlmostEqual(float(point2 @ matrix @ point1), 0.0, places=12)

    def test_simple_pinhole_calibration(self):
        camera = FakeCamera("SIMPLE_PINHOLE")
        camera.params = np.asarray([100, 50, 60], dtype=np.float64)
        np.testing.assert_array_equal(calibration_matrix(camera), [
            [100, 0, 50], [0, 100, 60], [0, 0, 1],
        ])

    def test_distorted_camera_is_rejected(self):
        camera = FakeCamera("OPENCV_FISHEYE")
        with self.assertRaisesRegex(ValueError, "curved epipolar loci"):
            calibration_matrix(camera)

    def test_zero_baseline_is_rejected(self):
        camera = FakeCamera()
        with self.assertRaisesRegex(ValueError, "baseline"):
            fundamental_matrix(
                FakeImage([0, 0, 0]), camera,
                FakeImage([0, 0, 0]), camera,
            )


if __name__ == "__main__":
    unittest.main()
