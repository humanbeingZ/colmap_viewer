import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

from viewer.colmap_service import ColmapService
from viewer.reprojection.core import GeometryData

MINIMAL_ASCII_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 0\nend_header\n"
)
LOADABLE_ASCII_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 1\n"
    b"property float x\nproperty float y\nproperty float z\n"
    b"property uchar red\nproperty uchar green\nproperty uchar blue\n"
    b"end_header\n0 0 1 255 255 255\n"
)
GAUSSIAN_ASCII_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 0\n"
    + b"".join(
        f"property float {name}\n".encode("ascii")
        for name in (
            "x", "y", "z", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3",
            "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
        )
    )
    + b"end_header\n"
)
CHANGED_ASCII_PLY = (
    b"ply\nformat ascii 1.0\ncomment replaced\nelement vertex 0\nend_header\n"
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
    def test_colmap_points_binary_ply_preserves_xyz_and_rgb(self):
        service = ColmapService("")
        service._colmap_geometry = GeometryData(
            xyz=np.asarray([
                [1.25, -2.5, 3.75],
                [4.5, 5.25, -6.0],
            ], dtype=np.float32),
            rgb=np.asarray([
                [10, 20, 30],
                [40, 50, 60],
            ], dtype=np.uint8),
            name="COLMAP points3D",
            kind="colmap",
            revision=0,
            cache_token="colmap",
        )

        chunks = list(service.iter_colmap_points_ply(chunk_size=1))

        self.assertIn(b"element vertex 2\n", chunks[0])
        vertex_dtype = np.dtype([
            ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
            ("red", "u1"), ("green", "u1"), ("blue", "u1"),
        ])
        vertices = np.frombuffer(b"".join(chunks[1:]), dtype=vertex_dtype)
        np.testing.assert_allclose(
            np.column_stack([vertices[axis] for axis in "xyz"]),
            service._colmap_geometry.xyz,
        )
        np.testing.assert_array_equal(
            np.column_stack([
                vertices["red"], vertices["green"], vertices["blue"],
            ]),
            service._colmap_geometry.rgb,
        )

    def test_images_include_exact_camera_and_world_to_camera_pose(self):
        service = ColmapService("")
        service.reconstruction = FakeReconstruction()

        self.assertEqual(service.get_reprojection_images(), [{
            "id": 12,
            "name": "frame.png",
            "width": 1920,
            "height": 1080,
            "has_mask": False,
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

    def test_input_mask_uses_matching_relative_stem(self):
        with (
            tempfile.TemporaryDirectory() as image_directory,
            tempfile.TemporaryDirectory() as mask_directory,
        ):
            image_root = Path(image_directory)
            mask_root = Path(mask_directory)
            (image_root / "cam0").mkdir()
            (mask_root / "cam0").mkdir()
            Image.new("RGB", (640, 320), "white").save(
                image_root / "cam0/frame.jpg"
            )
            mask_pixels = np.zeros((320, 640), dtype=np.uint8)
            mask_pixels[:, :320] = 255
            Image.fromarray(mask_pixels, "L").save(
                mask_root / "cam0/frame.png"
            )
            service = ColmapService(
                image_directory, mask_directory=mask_directory
            )
            service.reconstruction = SimpleNamespace(
                images={1: SimpleNamespace(name="cam0/frame.jpg", camera_id=2)},
                cameras={2: SimpleNamespace(width=640, height=320)},
                points3D={},
            )

            unmasked_encoded = service.get_reprojection_input_image(
                1, max_size=640, masked=False
            )
            masked_encoded = service.get_reprojection_input_image(
                1, max_size=640, masked=True
            )
            inverted_encoded = service.get_reprojection_input_image(
                1, max_size=640, masked=True, invert_mask=True
            )
            unmasked_pixels = np.asarray(
                Image.open(io.BytesIO(unmasked_encoded))
            )
            masked_pixels = np.asarray(
                Image.open(io.BytesIO(masked_encoded))
            )
            inverted_pixels = np.asarray(
                Image.open(io.BytesIO(inverted_encoded))
            )

        self.assertGreater(unmasked_pixels.mean(), 240)
        self.assertGreater(masked_pixels[:, :280].mean(), 240)
        self.assertLess(masked_pixels[:, 360:].mean(), 5)
        self.assertLess(inverted_pixels[:, :280].mean(), 5)
        self.assertGreater(inverted_pixels[:, 360:].mean(), 240)

    def test_configured_geometry_uses_a_token_without_exposing_its_path(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)

            descriptor = service.get_configured_geometry_file()

            self.assertEqual(descriptor["name"], os.path.basename(geometry_file.name))
            self.assertEqual(descriptor["size"], len(MINIMAL_ASCII_PLY))
            self.assertEqual(descriptor["kind"], "point cloud")
            self.assertRegex(descriptor["revision"], r"^[0-9a-f]{16}$")
            self.assertNotIn(geometry_file.name, descriptor.values())
            self.assertEqual(
                service.resolve_configured_geometry_file(descriptor["token"]),
                geometry_file.name,
            )
            self.assertIsNone(service.resolve_configured_geometry_file("wrong"))

    def test_overwritten_geometry_rotates_identity_and_drops_cached_metadata(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            with patch(
                "viewer.colmap_service.StreamablePlyMesh.inspect",
                return_value=None,
            ) as inspect_mesh:
                first = service.get_configured_geometry_file()

                geometry_file.seek(0)
                geometry_file.truncate()
                geometry_file.write(CHANGED_ASCII_PLY)
                geometry_file.flush()
                second = service.get_configured_geometry_file()

            self.assertNotEqual(second["revision"], first["revision"])
            self.assertNotEqual(second["token"], first["token"])
            self.assertEqual(inspect_mesh.call_count, 2)
            self.assertIsNone(
                service.resolve_configured_geometry_file(first["token"])
            )
            self.assertIsNone(
                service.resolve_configured_geometry_file(
                    second["token"], first["revision"]
                )
            )
            self.assertEqual(
                service.resolve_configured_geometry_file(
                    second["token"], second["revision"]
                ),
                geometry_file.name,
            )

    def test_kind_detection_failure_does_not_break_geometry_descriptor(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            service.get_configured_geometry_file()

            geometry_file.seek(0)
            geometry_file.truncate()
            geometry_file.write(b"not a ply")
            geometry_file.flush()

            descriptor = service.get_configured_geometry_file()
            self.assertIsNone(descriptor["kind"])

    def test_configured_geometry_identifies_gaussians_from_the_header(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(GAUSSIAN_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)

            descriptor = service.get_configured_geometry_file()

            self.assertEqual(descriptor["kind"], "gaussian splats")

    def test_server_local_geometry_replaces_path_and_rotates_token(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            old_token = service.get_configured_geometry_file()["token"]

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

    def test_multiple_configured_geometries_have_independent_capabilities(self):
        with (
            tempfile.NamedTemporaryFile(suffix=".ply") as first_file,
            tempfile.NamedTemporaryFile(suffix=".ply") as second_file,
        ):
            for geometry_file in (first_file, second_file):
                geometry_file.write(LOADABLE_ASCII_PLY)
                geometry_file.flush()
            service = ColmapService(
                "", geometry_paths=[first_file.name, second_file.name]
            )

            descriptors = service.get_configured_geometry_files()

            self.assertEqual(
                [descriptor["name"] for descriptor in descriptors],
                [
                    os.path.basename(first_file.name),
                    os.path.basename(second_file.name),
                ],
            )
            self.assertNotEqual(descriptors[0]["token"], descriptors[1]["token"])
            self.assertEqual(
                service.resolve_configured_geometry_file(
                    descriptors[0]["token"]
                ),
                first_file.name,
            )
            self.assertEqual(
                service.resolve_configured_geometry_file(
                    descriptors[1]["token"]
                ),
                second_file.name,
            )
            service.activate_configured_geometry(
                descriptors[0]["token"], "viewer:left"
            )
            service.activate_configured_geometry(
                descriptors[1]["token"], "viewer:right"
            )
            self.assertEqual(
                service.get_geometry_status("viewer:left")["name"],
                os.path.basename(first_file.name),
            )
            self.assertEqual(
                service.get_geometry_status("viewer:right")["name"],
                os.path.basename(second_file.name),
            )
            service.activate_configured_geometry(
                descriptors[1]["token"], "viewer:left"
            )
            service.activate_configured_geometry(
                descriptors[0]["token"], "viewer:left"
            )
            self.assertEqual(
                service.get_geometry_status("viewer:left")["name"],
                os.path.basename(first_file.name),
            )
            self.assertEqual(
                service.get_geometry_status("viewer:right")["name"],
                os.path.basename(second_file.name),
            )
            self.assertEqual(
                [
                    descriptor["server_loaded"]
                    for descriptor in service.get_configured_geometry_files()
                ],
                [True, True],
            )

    def test_configured_geometry_can_be_activated_for_server_rendering(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)
            descriptor = service.get_configured_geometry_file()

            server_geometry = GeometryData(
                xyz=np.zeros((1, 3), dtype=np.float32),
                rgb=np.zeros((1, 3), dtype=np.uint8),
                name="mesh",
                kind="triangle mesh",
                revision=1,
                cache_token="mesh",
            )
            with patch.object(
                service, "_read_external_geometry", return_value=server_geometry
            ) as load_geometry:
                status = service.activate_configured_geometry(
                    descriptor["token"], "viewer"
                )
                right_status = service.activate_configured_geometry(
                    descriptor["token"], "viewer:right"
                )

            self.assertEqual(status["kind"], "triangle mesh")
            self.assertEqual(right_status["cache_token"], "mesh")
            self.assertTrue(
                service.get_configured_geometry_file()["server_loaded"]
            )
            load_geometry.assert_called_once_with(geometry_file.name)

    def test_configured_geometry_is_not_eagerly_sampled_as_default(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as geometry_file:
            geometry_file.write(MINIMAL_ASCII_PLY)
            geometry_file.flush()
            service = ColmapService("", geometry_path=geometry_file.name)

            with patch.object(service, "load_external_geometry") as load_geometry:
                service.load()

            load_geometry.assert_not_called()
            self.assertFalse(
                service.get_configured_geometry_file()["server_loaded"]
            )
            self.assertEqual(
                service.get_geometry_status()["kind"], "colmap"
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
