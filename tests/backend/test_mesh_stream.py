import struct
import tempfile
import unittest

import numpy as np
from plyfile import PlyData, PlyElement

from viewer.geometry.mesh_stream import StreamablePlyMesh


class MeshStreamTest(unittest.TestCase):
    def write_mesh(self, path, polygons):
        vertices = np.array([
            (0.0, 0.0, 0.0, 128, 64, 32),
            (1.0, 0.0, 0.0, 0, 255, 0),
            (1.0, 1.0, 0.0, 0, 0, 255),
            (0.0, 1.0, 0.0, 255, 255, 255),
        ], dtype=[
            ("x", "f4"), ("y", "f4"), ("z", "f4"),
            ("red", "u1"), ("green", "u1"), ("blue", "u1"),
        ])
        faces = np.empty(len(polygons), dtype=[("vertex_indices", "O")])
        faces["vertex_indices"] = [np.asarray(face, dtype=np.int32) for face in polygons]
        PlyData([
            PlyElement.describe(vertices, "vertex"),
            PlyElement.describe(faces, "face"),
        ], text=False, byte_order="<").write(path)

    def test_triangle_mesh_is_remapped_into_bounded_chunks(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as source:
            self.write_mesh(source.name, [[0, 1, 2], [0, 2, 3], [1, 2, 3]])
            mesh = StreamablePlyMesh.inspect(source.name, chunk_face_count=2)

            self.assertIsNotNone(mesh)
            self.assertEqual(mesh.manifest()["chunk_count"], 2)
            payload = mesh.encode_chunk(0)

        magic, vertex_count, face_count = struct.unpack_from("<4sII", payload)
        self.assertEqual((magic, vertex_count, face_count), (b"CVM1", 4, 2))
        position_end = 12 + vertex_count * 12
        color_end = position_end + vertex_count * 3
        index_offset = (color_end + 3) & ~3
        positions = np.frombuffer(payload, "<f4", vertex_count * 3, 12).reshape(-1, 3)
        colors = np.frombuffer(payload, "u1", vertex_count * 3, position_end).reshape(-1, 3)
        indices = np.frombuffer(
            payload, "<u4", face_count * 3, index_offset
        ).reshape(-1, 3)
        np.testing.assert_array_equal(indices, [[0, 1, 2], [0, 2, 3]])
        np.testing.assert_array_equal(positions[indices[0]], [
            [0, 0, 0], [1, 0, 0], [1, 1, 0],
        ])
        # Stream the original sRGB bytes without an 8-bit linear round trip.
        np.testing.assert_array_equal(colors[0], [128, 64, 32])

    def test_non_triangle_mesh_is_not_streamed_with_fixed_offsets(self):
        with tempfile.NamedTemporaryFile(suffix=".ply") as source:
            self.write_mesh(source.name, [[0, 1, 2, 3]])
            self.assertIsNone(StreamablePlyMesh.inspect(source.name))


if __name__ == "__main__":
    unittest.main()
