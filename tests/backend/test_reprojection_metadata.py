import os
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from viewer.colmap_service import ColmapService

MINIMAL_ASCII_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 0\nend_header\n"
)


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
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)

            descriptor = service.get_configured_geometry_file()

            self.assertEqual(descriptor["name"], os.path.basename(geometry_file.name))
            self.assertEqual(descriptor["size"], len(MINIMAL_ASCII_PLY))
            self.assertNotIn(geometry_file.name, descriptor.values())
            self.assertEqual(
                service.resolve_configured_geometry_file(descriptor["token"]),
                geometry_file.name,
            )
            self.assertIsNone(service.resolve_configured_geometry_file("wrong"))

    def test_server_local_geometry_replaces_path_and_rotates_token(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            old_token = service._geometry_file_token

            descriptor = service.set_configured_geometry_file(
                geometry_file.name
            )

            self.assertEqual(
                descriptor["name"], os.path.basename(geometry_file.name)
            )
            self.assertNotEqual(descriptor["token"], old_token)
            self.assertIsNone(
                service.resolve_configured_geometry_file(old_token)
            )
            self.assertEqual(
                service.resolve_configured_geometry_file(descriptor["token"]),
                geometry_file.name,
            )

    def test_configured_geometry_can_be_activated_for_server_rendering(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            descriptor = service.get_configured_geometry_file()

            with patch.object(
                service,
                "load_external_geometry",
                return_value={"kind": "triangle mesh"},
            ) as load_geometry:
                status = service.activate_configured_geometry(
                    descriptor["token"], "viewer"
                )

            self.assertEqual(status["kind"], "triangle mesh")
            self.assertTrue(
                service.get_configured_geometry_file()["server_loaded"]
            )
            load_geometry.assert_called_once_with(
                geometry_file.name,
                request_stream="viewer",
                as_default=True,
                configured_token=descriptor["token"],
            )

    def test_server_local_geometry_rejects_missing_or_non_ply_files(self):
        service = ColmapService("")
        with self.assertRaisesRegex(ValueError, "does not exist"):
            service.set_configured_geometry_file("/missing/geometry.ply")
        with tempfile.NamedTemporaryFile(suffix=".obj") as geometry_file:
            with self.assertRaisesRegex(ValueError, "must be a .ply"):
                service.set_configured_geometry_file(geometry_file.name)
        with self.assertRaisesRegex(ValueError, "must be absolute"):
            service.set_configured_geometry_file("geometry.ply")
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(b"not a ply")
            geometry_file.flush()
            with self.assertRaisesRegex(ValueError, "PLY header"):
                service.set_configured_geometry_file(geometry_file.name)
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "secret.txt")
            link = os.path.join(directory, "geometry.ply")
            with open(target, "w", encoding="utf-8") as target_file:
                target_file.write("not geometry")
            os.symlink(target, link)
            with self.assertRaisesRegex(ValueError, "must be a .ply"):
                service.set_configured_geometry_file(link)


if __name__ == "__main__":
    unittest.main()
