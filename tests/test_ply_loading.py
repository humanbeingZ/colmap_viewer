import os
import struct
import tempfile
import unittest

import numpy as np

from ply_geometry import PlyGeometryLoader


def write_ordered_binary_ply(path: str, list_metadata: bool):
    metadata_property = (
        "property list uchar int values"
        if list_metadata
        else "property int value"
    )
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        "element metadata 2\n"
        f"{metadata_property}\n"
        "element vertex 3\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "end_header\n"
    ).encode("ascii")
    with open(path, "wb") as target:
        target.write(header)
        if list_metadata:
            target.write(struct.pack("<B2i", 2, 10, 11))
            target.write(struct.pack("<B1i", 1, 12))
        else:
            target.write(struct.pack("<2i", 10, 11))
        target.write(struct.pack("<9f", 1, 2, 3, 4, 5, 6, 7, 8, 9))


class PlyLoadingTest(unittest.TestCase):
    def setUp(self):
        self.loader = PlyGeometryLoader(
            max_points=5_000_000,
            max_triangles=2_000_000,
        )

    def test_binary_vertex_element_can_follow_fixed_or_list_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            for list_metadata in (False, True):
                with self.subTest(list_metadata=list_metadata):
                    path = os.path.join(directory, f"metadata-{list_metadata}.ply")
                    write_ordered_binary_ply(path, list_metadata)
                    xyz, rgb, kind = self.loader.load(path)
                    np.testing.assert_array_equal(
                        xyz,
                        [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
                    )
                    np.testing.assert_array_equal(
                        rgb, np.full((3, 3), 255, dtype=np.uint8)
                    )
                    self.assertEqual(kind, "point cloud")

    def test_missing_color_count_does_not_index_structured_records(self):
        class NoIndexData:
            dtype = np.dtype([("x", "f4"), ("unused", "V128")])

            def __len__(self):
                return 100

            def __getitem__(self, key):
                raise AssertionError("structured records were materialized")

        class Vertex:
            data = NoIndexData()

        selection = np.arange(0, 100, 2, dtype=np.int64)
        colors = self.loader._ply_vertex_colors(Vertex(), selection)
        self.assertEqual(colors.shape, (50, 3))


if __name__ == "__main__":
    unittest.main()
