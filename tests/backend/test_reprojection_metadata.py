import os
import tempfile
import unittest

import numpy as np

from viewer.colmap_service import ColmapService


class FakePose:
    def matrix(self):
        return np.array([
            [1.0, 0.0, 0.0, 2.0],
            [0.0, 1.0, 0.0, 3.0],
            [0.0, 0.0, 1.0, 4.0],
        ])


class FakeImage:
    camera_id = 7
    name = "frame.png"
    cam_from_world = FakePose()


class FakeCamera:
    width = 1920
    height = 1080
    model_name = "PINHOLE"
    params = np.array([1200.0, 1190.0, 960.0, 540.0])


class FakeReconstruction:
    images = {12: FakeImage()}
    cameras = {7: FakeCamera()}


class ReprojectionMetadataTest(unittest.TestCase):
    def test_images_include_exact_camera_and_world_to_camera_pose(self):
        service = ColmapService("")
        service.reconstruction = FakeReconstruction()

        self.assertEqual(service.get_reprojection_images(), [{
            "id": 12,
            "name": "frame.png",
            "width": 1920,
            "height": 1080,
            "camera": {
                "model": "PINHOLE",
                "params": [1200.0, 1190.0, 960.0, 540.0],
            },
            "cam_from_world": [
                [1.0, 0.0, 0.0, 2.0],
                [0.0, 1.0, 0.0, 3.0],
                [0.0, 0.0, 1.0, 4.0],
            ],
        }])

    def test_configured_geometry_uses_a_token_without_exposing_its_path(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(b"ply\n")
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)

            descriptor = service.get_configured_geometry_file()

            self.assertEqual(descriptor["name"], os.path.basename(geometry_file.name))
            self.assertEqual(descriptor["size"], 4)
            self.assertNotIn(geometry_file.name, descriptor.values())
            self.assertEqual(
                service.resolve_configured_geometry_file(descriptor["token"]),
                geometry_file.name,
            )
            self.assertIsNone(service.resolve_configured_geometry_file("wrong"))


if __name__ == "__main__":
    unittest.main()
