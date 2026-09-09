import sys
import tempfile
import unittest
from unittest.mock import patch

from main import parse_args


class CommandLineTest(unittest.TestCase):
    def test_geometry_option_accepts_multiple_paths(self):
        arguments = [
            "main.py", "-i", "/images", "-c", "/sparse",
            "-g", "first.ply", "second.ply", "third.ply",
        ]
        with (
            patch.object(sys, "argv", arguments),
            patch(
                "main.PlyGeometryLoader.resolve_path",
                side_effect=lambda path, require_absolute: f"/resolved/{path}",
            ),
        ):
            parsed = parse_args()

        self.assertEqual(parsed.geometry, [
            "/resolved/first.ply",
            "/resolved/second.ply",
            "/resolved/third.ply",
        ])

    def test_mask_option_accepts_an_existing_directory(self):
        with tempfile.TemporaryDirectory() as mask_directory:
            arguments = [
                "main.py", "-i", "/images", "-c", "/sparse",
                "-m", mask_directory,
            ]
            with patch.object(sys, "argv", arguments):
                parsed = parse_args()

        self.assertEqual(parsed.mask_directory, mask_directory)


if __name__ == "__main__":
    unittest.main()
