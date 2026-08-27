"""Bounded PLY point-cloud and mesh loading for reprojection."""

import os
from typing import Any, Dict

import numpy as np
from plyfile import PlyData


class PlyGeometryLoader:
    """Load PLY geometry into bounded, renderer-ready XYZ/RGB arrays."""

    def __init__(self, max_points: int, max_triangles: int):
        self.max_points = max_points
        self.max_triangles = max_triangles

    @staticmethod
    def _ply_vertex_colors(vertex, selection) -> np.ndarray:
        names = set(vertex.data.dtype.names or ())
        if {"red", "green", "blue"}.issubset(names):
            colors = np.column_stack([
                vertex["red"][selection],
                vertex["green"][selection],
                vertex["blue"][selection],
            ])
            if np.issubdtype(colors.dtype, np.floating):
                finite_max = np.nanmax(colors) if colors.size else 0
                if finite_max <= 1.0:
                    colors = colors * 255.0
            return np.clip(colors, 0, 255).astype(np.uint8)
        if {"f_dc_0", "f_dc_1", "f_dc_2"}.issubset(names):
            # Standard degree-zero spherical-harmonic conversion used by
            # 3D Gaussian Splatting. Higher-order SH, opacity, scale, and
            # rotation properties intentionally do not affect point rendering.
            sh_dc = np.column_stack([
                vertex["f_dc_0"][selection],
                vertex["f_dc_1"][selection],
                vertex["f_dc_2"][selection],
            ]).astype(np.float32, copy=False)
            colors = (0.5 + 0.28209479177387814 * sh_dc) * 255.0
            colors = np.nan_to_num(colors, nan=0.0, posinf=255.0, neginf=0.0)
            return np.rint(np.clip(colors, 0, 255)).astype(np.uint8)
        if isinstance(selection, slice):
            selected_count = len(range(*selection.indices(len(vertex.data))))
        else:
            selected_count = len(selection)
        return np.full((selected_count, 3), 255, dtype=np.uint8)

    def _ply_triangles(self, ply: PlyData, vertex_count: int):
        if "face" not in ply:
            return np.empty((0, 3), dtype=np.int64)
        face = ply["face"]
        names = set(face.data.dtype.names or ())
        index_name = next(
            (name for name in ("vertex_indices", "vertex_index") if name in names),
            None,
        )
        if index_name is None:
            return np.empty((0, 3), dtype=np.int64)
        polygons = face[index_name]
        triangle_count = 0
        for polygon in polygons:
            triangle_count += max(0, len(polygon) - 2)
            if triangle_count > self.max_triangles:
                return None
        try:
            uniform = np.stack(polygons).astype(np.int64, copy=False)
        except ValueError:
            uniform = None
        if uniform is not None and uniform.ndim == 2 and uniform.shape[1] >= 3:
            triangles = np.concatenate([
                uniform[:, (0, offset, offset + 1)]
                for offset in range(1, uniform.shape[1] - 1)
            ])
            valid = (triangles >= 0).all(axis=1) & (triangles < vertex_count).all(axis=1)
            return triangles[valid]

        triangles = []
        for polygon in polygons:
            indices = np.asarray(polygon, dtype=np.int64)
            if len(indices) < 3:
                continue
            for offset in range(1, len(indices) - 1):
                triangle = (int(indices[0]), int(indices[offset]), int(indices[offset + 1]))
                if min(triangle) >= 0 and max(triangle) < vertex_count:
                    triangles.append(triangle)
        if not triangles:
            return np.empty((0, 3), dtype=np.int64)
        return np.asarray(triangles, dtype=np.int64)

    @staticmethod
    def _ply_header_info(path: str) -> Dict[str, Any]:
        elements = {}
        current_element = None
        file_format = None
        face_index_name = None
        try:
            with open(path, "rb") as source:
                for line_index in range(10000):
                    raw_line = source.readline()
                    if not raw_line:
                        raise ValueError("PLY header has no end_header")
                    if source.tell() > 1024 * 1024:
                        raise ValueError("PLY header exceeds 1 MiB")
                    try:
                        line = raw_line.decode("ascii").strip()
                    except UnicodeDecodeError as exc:
                        raise ValueError("PLY header is not ASCII") from exc
                    if line_index == 0 and line != "ply":
                        raise ValueError("File does not begin with a PLY header")
                    fields = line.split()
                    if not fields:
                        continue
                    if fields[0] == "format" and len(fields) >= 2:
                        file_format = fields[1]
                    elif fields[0] == "element" and len(fields) == 3:
                        current_element = fields[1]
                        elements[current_element] = int(fields[2])
                    elif (
                        fields[0] == "property"
                        and current_element == "face"
                        and len(fields) >= 5
                        and fields[1] == "list"
                        and fields[-1] in {"vertex_indices", "vertex_index"}
                    ):
                        face_index_name = fields[-1]
                    elif fields[0] == "end_header":
                        break
        except OSError as exc:
            raise ValueError(f"Unable to read PLY header: {exc}") from exc
        if file_format is None:
            raise ValueError("PLY header has no format declaration")
        return {
            "format": file_format,
            "elements": elements,
            "face_index_name": face_index_name,
        }

    @classmethod
    def validate_header(cls, path: str) -> None:
        """Reject files that do not contain a bounded, parseable PLY header."""
        cls._ply_header_info(path)

    def _vertex_selection(self, count: int):
        if count <= self.max_points:
            return slice(None)
        # Sampling isolated records evenly across a memory map faults in nearly
        # every page of a huge PLY. Distributed contiguous blocks preserve broad
        # coverage while touching only approximately the selected record count.
        block_count = 64
        block_size = (self.max_points + block_count - 1) // block_count
        starts = np.linspace(
            0, max(0, count - block_size), block_count, dtype=np.int64
        )
        selection = np.empty(self.max_points, dtype=np.int64)
        cursor = 0
        for start in starts:
            length = min(block_size, self.max_points - cursor)
            selection[cursor:cursor + length] = np.arange(
                start, start + length, dtype=np.int64
            )
            cursor += length
            if cursor == self.max_points:
                break
        return selection

    def _selected_ply_vertices(
        self, vertex, selection, reject_nonfinite: bool = False
    ):
        names = set(vertex.data.dtype.names or ())
        if not {"x", "y", "z"}.issubset(names):
            raise ValueError("PLY vertices must contain x, y, and z properties")
        vertices = np.column_stack([
            vertex["x"][selection],
            vertex["y"][selection],
            vertex["z"][selection],
        ]).astype(np.float32, copy=False)
        colors = self._ply_vertex_colors(vertex, selection)
        finite = np.isfinite(vertices).all(axis=1)
        if reject_nonfinite and not finite.all():
            raise ValueError("Mesh PLY contains non-finite vertex coordinates")
        vertices, colors = vertices[finite], colors[finite]
        if not len(vertices):
            raise ValueError("PLY contains no finite selected vertices")
        return (
            np.ascontiguousarray(vertices, dtype=np.float32),
            np.ascontiguousarray(colors, dtype=np.uint8),
        )

    @staticmethod
    def _memory_map_vertex_element(path: str):
        """Map a fixed-width binary vertex element without loading others."""
        try:
            with open(path, "rb") as source:
                schema = PlyData._parse_header(source)
                data_offset = source.tell()
                file_size = os.fstat(source.fileno()).st_size

                if schema.text:
                    raise ValueError("Memory-mapped PLY loading requires binary data")

                vertex = None
                for element in schema.elements:
                    if element.name == "vertex":
                        vertex = element
                        break
                    properties = list(element.properties)
                    if not any(hasattr(prop, "len_dtype") for prop in properties):
                        record_size = element.dtype(schema.byte_order).itemsize
                        source.seek(element.count * record_size, os.SEEK_CUR)
                        continue

                    # List-valued records have no fixed stride. Scan only their
                    # length fields and seek over their payloads, keeping memory
                    # usage constant regardless of the preceding element size.
                    for _ in range(element.count):
                        for prop in properties:
                            if hasattr(prop, "len_dtype"):
                                len_type, value_type = prop.list_dtype(
                                    schema.byte_order
                                )
                                length_dtype = np.dtype(len_type)
                                raw_length = source.read(length_dtype.itemsize)
                                if len(raw_length) != length_dtype.itemsize:
                                    raise ValueError(
                                        "PLY ended before the vertex element"
                                    )
                                length = int(
                                    np.frombuffer(raw_length, dtype=length_dtype)[0]
                                )
                                if length < 0:
                                    raise ValueError(
                                        "PLY list before vertex has a negative length"
                                    )
                                source.seek(
                                    length * np.dtype(value_type).itemsize,
                                    os.SEEK_CUR,
                                )
                            else:
                                source.seek(
                                    np.dtype(prop.dtype(schema.byte_order)).itemsize,
                                    os.SEEK_CUR,
                                )
                        if source.tell() > file_size:
                            raise ValueError("PLY ended before the vertex element")
                data_offset = source.tell()
        except Exception as exc:
            if isinstance(exc, ValueError):
                raise
            raise ValueError(f"Unable to parse PLY header: {exc}") from exc
        if vertex is None:
            raise ValueError("PLY contains no vertex element")
        if any(hasattr(property_, "len_dtype") for property_ in vertex.properties):
            raise ValueError("Memory-mapped vertex elements cannot contain list properties")
        vertex_size = vertex.count * vertex.dtype(schema.byte_order).itemsize
        if data_offset + vertex_size > file_size:
            raise ValueError("PLY vertex element extends beyond end-of-file")
        vertex.data = np.memmap(
            path,
            dtype=vertex.dtype(schema.byte_order),
            mode="r",
            offset=data_offset,
            shape=vertex.count,
        )
        return vertex

    def _sample_mesh_surface(
        self,
        vertices: np.ndarray,
        colors: np.ndarray,
        triangles: np.ndarray,
    ):
        triangle_vertices = vertices[triangles]
        cross = np.cross(
            triangle_vertices[:, 1] - triangle_vertices[:, 0],
            triangle_vertices[:, 2] - triangle_vertices[:, 0],
        )
        area = np.linalg.norm(cross, axis=1)
        valid = np.isfinite(area) & (area > 0)
        triangles, area = triangles[valid], area[valid]
        if not len(triangles):
            return vertices, colors

        sample_count = min(
            self.max_points,
            max(len(vertices), 2 * len(triangles)),
        )
        rng = np.random.default_rng(0)
        chosen = rng.choice(len(triangles), sample_count, p=area / area.sum())
        sampled_triangles = triangles[chosen]
        sampled_vertices = vertices[sampled_triangles]
        root = np.sqrt(rng.random(sample_count, dtype=np.float32))
        along = rng.random(sample_count, dtype=np.float32)
        weights = np.column_stack([
            1.0 - root,
            root * (1.0 - along),
            root * along,
        ]).astype(np.float32, copy=False)
        points = np.einsum("ni,nij->nj", weights, sampled_vertices)
        sampled_colors = colors[sampled_triangles].astype(np.float32)
        point_colors = np.einsum("ni,nij->nj", weights, sampled_colors)
        return (
            np.ascontiguousarray(points, dtype=np.float32),
            np.clip(point_colors, 0, 255).astype(np.uint8),
        )

    def load(self, path: str) -> tuple[np.ndarray, np.ndarray, str]:
        header = self._ply_header_info(path)
        vertex_count = header["elements"].get("vertex", 0)
        face_count = header["elements"].get("face", 0)
        if vertex_count <= 0:
            raise ValueError("PLY contains no vertex element")
        large_mesh = bool(face_count) and (
            vertex_count > self.max_points
            or face_count > self.max_triangles
        )
        if header["format"] == "ascii" and (
            vertex_count > self.max_points
            or face_count > self.max_triangles
        ):
            raise ValueError(
                "Large ASCII PLY files are not memory-mappable; convert to binary PLY"
            )
        if not face_count and header["format"] != "ascii":
            vertex = self._memory_map_vertex_element(path)
            selection = self._vertex_selection(len(vertex))
            vertices, colors = self._selected_ply_vertices(vertex, selection)
            return vertices, colors, "point cloud"
        if large_mesh:
            index_name = header["face_index_name"]
            if not index_name:
                raise ValueError("Large mesh PLY has no face vertex-index property")
            # Parse the schema with plyfile, then map only the vertex records.
            # Mapping a later face element would retain gigabytes of
            # address space even though this bounded fallback never reads it.
            vertex = self._memory_map_vertex_element(path)
            selection = self._vertex_selection(len(vertex))
            vertices, colors = self._selected_ply_vertices(vertex, selection)
            return vertices, colors, "mesh vertices"
        try:
            ply = PlyData.read(path)
        except Exception as exc:
            raise ValueError(f"Unable to read PLY: {exc}") from exc
        vertex = ply["vertex"]
        if not face_count:
            selection = self._vertex_selection(len(vertex))
            vertices, colors = self._selected_ply_vertices(vertex, selection)
            return vertices, colors, "point cloud"

        vertices, colors = self._selected_ply_vertices(
            vertex, slice(None), reject_nonfinite=True
        )
        triangles = self._ply_triangles(ply, len(vertex))
        if triangles is None:
            selection = self._vertex_selection(len(vertices))
            return (
                np.ascontiguousarray(vertices[selection], dtype=np.float32),
                np.ascontiguousarray(colors[selection], dtype=np.uint8),
                "mesh vertices",
            )
        if len(triangles):
            points, point_colors = self._sample_mesh_surface(
                vertices, colors, triangles
            )
            return points, point_colors, "mesh"
        return (
            np.ascontiguousarray(vertices, dtype=np.float32),
            np.ascontiguousarray(colors, dtype=np.uint8),
            "point cloud",
        )
