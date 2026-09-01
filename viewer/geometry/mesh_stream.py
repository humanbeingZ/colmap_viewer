"""Memory-bounded streaming for very large binary triangle PLY meshes."""

from dataclasses import dataclass
import os
import struct
from typing import Optional

import numpy as np
from plyfile import PlyData


_CHUNK_HEADER = struct.Struct("<4sIII")
_DRAW_RECORD = struct.Struct("<II6f")
_CHUNK_MAGIC = b"CVM2"


@dataclass(frozen=True)
class StreamablePlyMesh:
    """A fixed-record binary PLY that can be remapped into local mesh chunks."""

    path: str
    vertex_count: int
    face_count: int
    vertex_offset: int
    face_offset: int
    vertex_dtype: np.dtype
    face_dtype: np.dtype
    chunk_face_count: int = 2_000_000
    draw_face_count: int = 100_000

    @classmethod
    def inspect(
        cls, path: str, chunk_face_count: int = 2_000_000,
        draw_face_count: int = 100_000,
    ) -> Optional["StreamablePlyMesh"]:
        """Return a stream source when the PLY has a fixed triangle layout."""
        if chunk_face_count <= 0 or draw_face_count <= 0:
            raise ValueError("Mesh chunk and draw sizes must be positive")
        try:
            with open(path, "rb") as source:
                schema = PlyData._parse_header(source)
                vertex_offset = source.tell()
        except Exception:
            return None
        if schema.text or schema.byte_order != "<":
            return None
        if [element.name for element in schema.elements] != ["vertex", "face"]:
            return None
        vertex, face = schema.elements
        if any(hasattr(prop, "len_dtype") for prop in vertex.properties):
            return None
        vertex_names = {prop.name for prop in vertex.properties}
        if not {"x", "y", "z"}.issubset(vertex_names):
            return None
        if len(face.properties) != 1:
            return None
        indices = face.properties[0]
        if not hasattr(indices, "len_dtype") or indices.name not in {
            "vertex_indices", "vertex_index"
        }:
            return None
        length_dtype, index_dtype = indices.list_dtype(schema.byte_order)
        if np.dtype(length_dtype).itemsize != 1 or np.dtype(index_dtype).itemsize != 4:
            return None

        vertex_dtype = vertex.dtype(schema.byte_order)
        face_dtype = np.dtype([
            ("count", np.dtype(length_dtype)),
            ("indices", np.dtype(index_dtype), (3,)),
        ])
        face_offset = vertex_offset + vertex.count * vertex_dtype.itemsize
        expected_size = face_offset + face.count * face_dtype.itemsize
        if expected_size != os.path.getsize(path):
            # Variable polygon sizes or trailing elements cannot use fixed
            # offsets safely and must remain on the ordinary loader path.
            return None
        return cls(
            path=path,
            vertex_count=vertex.count,
            face_count=face.count,
            vertex_offset=vertex_offset,
            face_offset=face_offset,
            vertex_dtype=vertex_dtype,
            face_dtype=face_dtype,
            chunk_face_count=chunk_face_count,
            draw_face_count=draw_face_count,
        )

    @property
    def chunk_count(self) -> int:
        return (self.face_count + self.chunk_face_count - 1) // self.chunk_face_count

    def manifest(self) -> dict:
        return {
            "format": "CVM2",
            "vertex_count": self.vertex_count,
            "face_count": self.face_count,
            "chunk_face_count": self.chunk_face_count,
            "draw_face_count": self.draw_face_count,
            "chunk_count": self.chunk_count,
        }

    def encode_chunk(self, chunk_index: int) -> bytes:
        """Encode one face block with compact local vertex indices."""
        if chunk_index < 0 or chunk_index >= self.chunk_count:
            raise IndexError("Mesh chunk index is out of range")
        start = chunk_index * self.chunk_face_count
        stop = min(self.face_count, start + self.chunk_face_count)
        faces = np.memmap(
            self.path,
            dtype=self.face_dtype,
            mode="r",
            offset=self.face_offset,
            shape=self.face_count,
        )[start:stop]
        if not np.all(faces["count"] == 3):
            raise ValueError("Streamed mesh contains a non-triangle face")
        global_indices = np.asarray(faces["indices"]).reshape(-1)
        if (global_indices < 0).any() or (global_indices >= self.vertex_count).any():
            raise ValueError("Streamed mesh contains an invalid vertex index")
        selected, local_indices = np.unique(
            global_indices, return_inverse=True
        )

        vertices = np.memmap(
            self.path,
            dtype=self.vertex_dtype,
            mode="r",
            offset=self.vertex_offset,
            shape=self.vertex_count,
        )
        positions = np.column_stack([
            vertices["x"][selected],
            vertices["y"][selected],
            vertices["z"][selected],
        ]).astype("<f4", copy=False)
        if not np.isfinite(positions).all():
            raise ValueError("Streamed mesh contains non-finite positions")
        names = set(self.vertex_dtype.names or ())
        if {"red", "green", "blue"}.issubset(names):
            colors = np.column_stack([
                vertices["red"][selected],
                vertices["green"][selected],
                vertices["blue"][selected],
            ])
            if np.issubdtype(colors.dtype, np.floating):
                if colors.size and np.nanmax(colors) <= 1.0:
                    colors = colors * 255.0
            colors = np.clip(colors, 0, 255).astype(np.uint8)
        else:
            colors = np.full((len(selected), 3), 255, dtype=np.uint8)
        local_indices = local_indices.astype("<u4", copy=False).reshape(-1, 3)
        draw_records = []
        for draw_start in range(0, len(local_indices), self.draw_face_count):
            draw_stop = min(len(local_indices), draw_start + self.draw_face_count)
            draw_vertices = positions[
                local_indices[draw_start:draw_stop].reshape(-1)
            ]
            minimum = draw_vertices.min(axis=0)
            maximum = draw_vertices.max(axis=0)
            draw_records.append(_DRAW_RECORD.pack(
                draw_start,
                draw_stop - draw_start,
                *minimum,
                *maximum,
            ))
        header = _CHUNK_HEADER.pack(
            _CHUNK_MAGIC, len(selected), stop - start, len(draw_records)
        )
        color_bytes = np.ascontiguousarray(colors).tobytes()
        color_padding = b"\0" * (-len(color_bytes) % 4)
        return b"".join((
            header,
            *draw_records,
            np.ascontiguousarray(positions).tobytes(),
            color_bytes,
            color_padding,
            np.ascontiguousarray(local_indices).tobytes(),
        ))
