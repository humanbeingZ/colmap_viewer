"""Thread-safe state primitives shared by the reprojection service."""

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Optional

import numpy as np


class RenderSuperseded(RuntimeError):
    """Raised when a newer cold projection request replaces this one."""


class InputSuperseded(RuntimeError):
    """Raised when a newer source-image request replaces this one."""


class GeometryCapacityError(RuntimeError):
    """Raised instead of silently replacing another viewer's geometry."""


class GeometryUploadSuperseded(RuntimeError):
    """Raised when a newer upload has replaced this upload request."""


class GeometrySelectionSuperseded(RuntimeError):
    """Raised when a newer geometry selection has replaced this request."""


@dataclass(frozen=True)
class GeometryData:
    xyz: np.ndarray
    rgb: np.ndarray
    name: str
    kind: str
    revision: int
    cache_token: str


class BoundedLRUCache:
    """Small thread-safe LRU cache with a fixed entry count."""

    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("cache capacity must be positive")
        self._capacity = capacity
        self._values = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple):
        with self._lock:
            value = self._values.get(key)
            if value is not None:
                self._values.move_to_end(key)
            return value

    def put(self, key: tuple, value: Any):
        with self._lock:
            self._values[key] = value
            self._values.move_to_end(key)
            while len(self._values) > self._capacity:
                self._values.popitem(last=False)
        return value


class SupersessionTracker:
    """Tracks the newest request independently for each viewer stream."""

    def __init__(
        self,
        exception_type: type[RuntimeError],
        normalize_stream: Callable[[str], str],
        max_streams: int = 256,
    ):
        self._exception_type = exception_type
        self._normalize_stream = normalize_stream
        self._max_streams = max_streams
        self._sequence = 0
        self._latest = OrderedDict()
        self._lock = threading.Lock()

    def begin(self, request_stream: str) -> int:
        stream = self._normalize_stream(request_stream)
        with self._lock:
            self._sequence += 1
            request_id = self._sequence
            self._latest[stream] = request_id
            self._latest.move_to_end(stream)
            while len(self._latest) > self._max_streams:
                self._latest.popitem(last=False)
            return request_id

    def check(self, request_stream: str, request_id: int):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            if request_id != self._latest.get(stream):
                raise self._exception_type()

    def commit(self, request_stream: str, request_id: int, publish: Callable):
        """Publish only if this request is still current for its stream."""
        stream = self._normalize_stream(request_stream)
        with self._lock:
            if request_id != self._latest.get(stream):
                raise self._exception_type()
            return publish()


class ViewerGeometryStore:
    """Owns per-viewer geometry selection, upload generations, and expiry."""

    def __init__(
        self,
        max_uploaded_geometries: int,
        max_colmap_selections: int,
        idle_timeout_seconds: float,
        normalize_stream: Callable[[str], str],
        clock: Callable[[], float] = time.monotonic,
    ):
        self._max_uploaded = max_uploaded_geometries
        self._max_colmap = max_colmap_selections
        self._idle_timeout = idle_timeout_seconds
        self._normalize_stream = normalize_stream
        self._clock = clock
        self._lock = threading.Lock()
        self._default: Optional[GeometryData] = None
        self._uploaded = OrderedDict()
        self._colmap_streams = set()
        self._pending_uploads = {}
        self._last_seen = {}
        self._latest_client_generations = {}
        self._upload_sequence = 0
        self._revision_sequence = 0

    def _expire_locked(self):
        now = self._clock()
        expired = [
            stream
            for stream, last_seen in self._last_seen.items()
            if (
                now - last_seen > self._idle_timeout
                and stream not in self._pending_uploads
            )
        ]
        for stream in expired:
            self._uploaded.pop(stream, None)
            self._colmap_streams.discard(stream)
            self._last_seen.pop(stream, None)
            self._latest_client_generations.pop(stream, None)

    def _touch_locked(self, request_stream: str) -> str:
        stream = self._normalize_stream(request_stream)
        self._expire_locked()
        self._last_seen[stream] = self._clock()
        return stream

    def _selected_locked(self, stream: str) -> Optional[GeometryData]:
        if stream in self._colmap_streams:
            return None
        geometry = self._uploaded.get(stream)
        if geometry is not None:
            self._uploaded.move_to_end(stream)
            return geometry
        return self._default

    def selected(self, request_stream: str) -> Optional[GeometryData]:
        with self._lock:
            stream = self._touch_locked(request_stream)
            return self._selected_locked(stream)

    def status(self, request_stream: str, colmap_count: int) -> dict:
        geometry = self.selected(request_stream)
        if geometry is None:
            return {
                "name": "COLMAP points3D",
                "kind": "colmap",
                "point_count": int(colmap_count),
                "revision": 0,
                "cache_token": "colmap",
            }
        return {
            "name": geometry.name,
            "kind": geometry.kind,
            "point_count": int(len(geometry.xyz)),
            "revision": geometry.revision,
            "cache_token": geometry.cache_token,
        }

    def touch(self, request_stream: str):
        with self._lock:
            self._touch_locked(request_stream)

    def release(self, request_stream: str):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            self._uploaded.pop(stream, None)
            self._colmap_streams.discard(stream)
            self._pending_uploads.pop(stream, None)
            self._last_seen.pop(stream, None)
            self._latest_client_generations.pop(stream, None)

    def begin_upload(
        self, request_stream: str, client_generation: Optional[int] = None
    ) -> int:
        stream = self._normalize_stream(request_stream)
        with self._lock:
            self._expire_locked()
            if client_generation is not None:
                latest = self._latest_client_generations.get(stream, -1)
                if client_generation <= latest:
                    raise GeometryUploadSuperseded(
                        "A newer geometry upload already exists for this viewer"
                    )

            is_new = stream not in self._uploaded and stream not in self._pending_uploads
            reserved_new = sum(
                pending_stream not in self._uploaded
                for pending_stream in self._pending_uploads
            )
            if is_new and len(self._uploaded) + reserved_new >= self._max_uploaded:
                raise GeometryCapacityError(
                    "The server already has the maximum of "
                    f"{self._max_uploaded} active uploaded geometries; reset one "
                    "viewer to COLMAP points3D or wait for an idle viewer to "
                    "expire before uploading another"
                )

            if client_generation is not None:
                self._latest_client_generations[stream] = client_generation
            self._upload_sequence += 1
            upload_token = self._upload_sequence
            self._pending_uploads[stream] = upload_token
            self._last_seen[stream] = self._clock()
            return upload_token

    def cancel_upload(self, request_stream: str, upload_token: int):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            if self._pending_uploads.get(stream) == upload_token:
                self._pending_uploads.pop(stream, None)

    def require_current_upload(self, request_stream: str, upload_token: int):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            if self._pending_uploads.get(stream) != upload_token:
                raise GeometryUploadSuperseded(
                    "A newer geometry upload replaced this request"
                )

    def next_revision(self) -> int:
        with self._lock:
            self._revision_sequence += 1
            return self._revision_sequence

    def install(
        self,
        request_stream: str,
        upload_token: int,
        geometry: GeometryData,
    ):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            if self._pending_uploads.get(stream) != upload_token:
                raise GeometryUploadSuperseded(
                    "A newer geometry upload replaced this request"
                )
            self._uploaded[stream] = geometry
            self._uploaded.move_to_end(stream)
            self._colmap_streams.discard(stream)
            self._last_seen[stream] = self._clock()

    def select(self, request_stream: str, geometry: GeometryData):
        """Select an already-loaded geometry for one viewer stream."""
        with self._lock:
            stream = self._touch_locked(request_stream)
            if (
                stream not in self._uploaded
                and len(self._uploaded) >= self._max_uploaded
            ):
                raise GeometryCapacityError(
                    "The server already has the maximum of "
                    f"{self._max_uploaded} active geometry selections; reset "
                    "one viewer to COLMAP points3D or wait for an idle viewer "
                    "to expire before selecting another"
                )
            self._uploaded[stream] = geometry
            self._uploaded.move_to_end(stream)
            self._colmap_streams.discard(stream)
            self._pending_uploads.pop(stream, None)
            self._last_seen[stream] = self._clock()

    def set_default(self, geometry: GeometryData):
        with self._lock:
            self._default = geometry

    def reset_to_colmap(self, request_stream: str):
        stream = self._normalize_stream(request_stream)
        with self._lock:
            self._expire_locked()
            if stream not in self._colmap_streams and len(self._colmap_streams) >= self._max_colmap:
                raise GeometryCapacityError(
                    "The server has too many explicit COLMAP viewer selections"
                )
            self._uploaded.pop(stream, None)
            self._colmap_streams.add(stream)
            self._pending_uploads.pop(stream, None)
            self._last_seen[stream] = self._clock()
