import pycolmap
import os
import io
import hashlib
import hmac
import logging
import secrets
import threading
from typing import Any, Dict, Iterator, List, Optional
from enum import Enum

import numpy as np
from PIL import Image
from .geometry.epipolar import PoseNeighborIndex, fundamental_matrix
from .geometry.mesh_stream import StreamablePlyMesh
from .geometry.ply import (
    PlyGeometryLoader,
    geometry_file_identity,
    geometry_file_revision,
)
from .reprojection.core import (
    BoundedLRUCache,
    GeometryData,
    InputSuperseded,
    SupersessionTracker,
    ViewerGeometryStore,
)
from .reprojection.renderer import ReprojectionRenderer


logger = logging.getLogger(__name__)


class DataSource(Enum):
    SFM_MODEL = "SfM Model"
    DATABASE = "Database"


TWO_VIEW_CONFIGURATION_LABELS = {
    0: "Undefined",
    1: "Degenerate",
    2: "Calibrated",
    3: "Uncalibrated",
    4: "Planar",
    5: "Panoramic",
    6: "Planar or Panoramic",
    7: "Watermark",
    8: "Multiple",
    9: "Calibrated Rig",
}


class ColmapService:
    MAX_EXTERNAL_POINTS = 5_000_000
    MAX_MESH_TRIANGLES = 2_000_000
    MAX_STREAM_GEOMETRIES = 8
    MAX_COLMAP_STREAM_SELECTIONS = 1024
    STREAM_IDLE_TIMEOUT_SECONDS = 10 * 60
    MAX_REPROJECTION_SIZE = ReprojectionRenderer.MAX_PREVIEW_SIZE
    MAX_INPUT_SIZE = 8192
    DEFAULT_POSE_NEIGHBORS = 32
    MAX_POSE_NEIGHBORS = 256

    def __init__(
        self,
        image_path: str,
        project_path: Optional[str] = None,
        db_path: Optional[str] = None,
        geometry_path: Optional[str] = None,
    ):
        self.image_base_path = image_path
        self.project_path = project_path
        self.db_path = db_path
        self.geometry_path = geometry_path
        self._geometry_file_token = secrets.token_urlsafe(32)
        self._configured_geometry_server_loaded = False
        self._configured_geometry_identity = None
        self._configured_mesh_stream: Optional[StreamablePlyMesh] = None
        self._configured_mesh_stream_inspected = False
        self._configured_mesh_warmup_key: Optional[str] = None
        self._configured_geometry_lock = threading.RLock()
        namespace_source = "\0".join(
            os.path.abspath(path) if path else ""
            for path in (image_path, project_path, db_path)
        )
        self.cache_namespace = hashlib.sha256(
            namespace_source.encode("utf-8")
        ).hexdigest()[:16]

        self.reconstruction: Optional[pycolmap.Reconstruction] = None
        self.db: Optional[pycolmap.Database] = None

        self.sources: List[DataSource] = []
        self.active_source: Optional[DataSource] = None

        # Geometry arrays are intentionally initialized only when reprojection
        # mode is first used. Match-only sessions do not pay the memory cost.
        self._geometry_build_lock = threading.Lock()
        self._pose_neighbor_lock = threading.Lock()
        self._pose_neighbor_index: Optional[PoseNeighborIndex] = None
        self._colmap_geometry: Optional[GeometryData] = None
        self._geometry_store = ViewerGeometryStore(
            max_uploaded_geometries=self.MAX_STREAM_GEOMETRIES,
            max_colmap_selections=self.MAX_COLMAP_STREAM_SELECTIONS,
            idle_timeout_seconds=self.STREAM_IDLE_TIMEOUT_SECONDS,
            normalize_stream=self._request_stream,
        )
        self._input_lock = threading.Lock()
        self._input_requests = SupersessionTracker(
            InputSuperseded, self._request_stream
        )
        self._warmup_started = False
        self._png_cache = BoundedLRUCache(20)
        self._ply_loader = PlyGeometryLoader(
            max_points=self.MAX_EXTERNAL_POINTS,
            max_triangles=self.MAX_MESH_TRIANGLES,
        )
        self._renderer = ReprojectionRenderer(
            normalize_stream=self._request_stream,
            png_cache=self._png_cache,
        )

    def _refresh_configured_geometry_locked(self, path: str) -> None:
        identity = geometry_file_identity(path)
        if identity == self._configured_geometry_identity:
            return
        if self._configured_geometry_identity is not None:
            # Bind every browser-visible URL to one concrete file identity.
            self._geometry_file_token = secrets.token_urlsafe(32)
        self._configured_geometry_identity = identity
        self._configured_geometry_server_loaded = False
        self._configured_mesh_stream = None
        self._configured_mesh_stream_inspected = False
        self._configured_mesh_warmup_key = None

    def get_configured_geometry_file(self) -> Optional[Dict[str, Any]]:
        """Describe the selected server-local geometry without exposing its path."""
        with self._configured_geometry_lock:
            path = self.geometry_path
            if not path or not os.path.isfile(path):
                return None
            self._refresh_configured_geometry_locked(path)
            if not self._configured_mesh_stream_inspected:
                self._configured_mesh_stream = StreamablePlyMesh.inspect(path)
                self._configured_mesh_stream_inspected = True
            try:
                kind = self._ply_loader.inspect_kind(path)
            except ValueError:
                # The client can still inspect the fetched header and report a
                # useful load error if the file changed after selection.
                kind = None
            descriptor = {
                "name": os.path.basename(path),
                "size": os.path.getsize(path),
                "kind": kind,
                "revision": geometry_file_revision(path),
                "token": self._geometry_file_token,
                "server_loaded": self._configured_geometry_server_loaded,
            }
            mesh_stream = self._configured_mesh_stream
            if mesh_stream and mesh_stream.face_count > mesh_stream.chunk_face_count:
                descriptor["mesh_stream"] = mesh_stream.manifest()
            return descriptor

    def set_configured_geometry_file(self, path: str) -> Dict[str, Any]:
        """Select a server-local PLY for the configured streaming path."""
        resolved = self._ply_loader.resolve_path(path)
        with self._configured_geometry_lock:
            self.geometry_path = resolved
            self._geometry_file_token = secrets.token_urlsafe(32)
            self._configured_geometry_server_loaded = False
            self._configured_geometry_identity = None
            self._configured_mesh_stream = None
            self._configured_mesh_stream_inspected = False
            descriptor = self.get_configured_geometry_file()
        self.start_configured_mesh_warmup()
        return descriptor

    def start_configured_mesh_warmup(self) -> None:
        """Prebuild exact compressed chunks while the user opens the viewer."""
        mesh_stream = self.get_configured_mesh_stream()
        if (
            mesh_stream is None
            or mesh_stream.face_count <= mesh_stream.chunk_face_count
        ):
            return
        cache_key = mesh_stream.cache_key
        with self._configured_geometry_lock:
            if self._configured_mesh_warmup_key == cache_key:
                return
            self._configured_mesh_warmup_key = cache_key

        def warm() -> None:
            try:
                mesh_stream.warm_gzip_cache()
            except (OSError, ValueError) as error:
                with self._configured_geometry_lock:
                    if self._configured_mesh_warmup_key == cache_key:
                        self._configured_mesh_warmup_key = None
                logger.warning("Unable to warm mesh chunk cache: %s", error)

        threading.Thread(
            target=warm,
            name="mesh-chunk-warmup",
            daemon=True,
        ).start()

    def activate_configured_geometry(
        self, token: str, request_stream: str = "default"
    ) -> Dict[str, Any]:
        path = self.resolve_configured_geometry_file(token)
        if path is None:
            raise ValueError("Configured geometry selection has changed")
        status = self.load_external_geometry(
            path,
            request_stream=request_stream,
            as_default=True,
            configured_token=token,
        )
        with self._configured_geometry_lock:
            if (
                self.geometry_path == path
                and hmac.compare_digest(token, self._geometry_file_token)
            ):
                self._configured_geometry_server_loaded = True
        return status

    def resolve_configured_geometry_file(
        self, token: str, revision: Optional[str] = None
    ) -> Optional[str]:
        """Resolve selected geometry for its unguessable capability token."""
        with self._configured_geometry_lock:
            if not self.geometry_path or not os.path.isfile(self.geometry_path):
                return None
            self._refresh_configured_geometry_locked(self.geometry_path)
            if not hmac.compare_digest(token, self._geometry_file_token):
                return None
            if (
                revision is not None
                and not hmac.compare_digest(
                    revision, geometry_file_revision(self.geometry_path)
                )
            ):
                return None
            return self.geometry_path

    def get_configured_mesh_stream(
        self, token: Optional[str] = None, revision: Optional[str] = None
    ) -> Optional[StreamablePlyMesh]:
        if (
            token is not None
            and self.resolve_configured_geometry_file(token, revision) is None
        ):
            return None
        if not self.geometry_path or not os.path.isfile(self.geometry_path):
            return None
        with self._configured_geometry_lock:
            self._refresh_configured_geometry_locked(self.geometry_path)
            if not self._configured_mesh_stream_inspected:
                self._configured_mesh_stream = StreamablePlyMesh.inspect(
                    self.geometry_path
                )
                self._configured_mesh_stream_inspected = True
            return self._configured_mesh_stream

    def load(self):
        """Loads the available COLMAP data sources."""
        # Try to load reconstruction
        if self.project_path and os.path.exists(self.project_path):
            try:
                self.reconstruction = pycolmap.Reconstruction(self.project_path)
                self.sources.append(DataSource.SFM_MODEL)
                print(
                    f"Loaded COLMAP reconstruction with {len(self.reconstruction.images)} images and {len(self.reconstruction.points3D)} 3D points.")
            except Exception as e:
                print(f"Error loading COLMAP reconstruction: {e}")
                self.reconstruction = None

        # Determine database path
        db_to_load = self.db_path
        if not db_to_load and self.project_path:
            candidate_db_path = os.path.join(self.project_path, "database.db")
            if os.path.exists(candidate_db_path):
                db_to_load = candidate_db_path

        # Try to load database
        if db_to_load and os.path.exists(db_to_load):
            try:
                self.db = pycolmap.Database(db_to_load)
                self.sources.append(DataSource.DATABASE)
                print("Loaded COLMAP database.")
            except Exception as e:
                print(f"Error loading COLMAP database: {e}")
                self.db = None
        
        # Set default active source
        if DataSource.SFM_MODEL in self.sources:
            self.active_source = DataSource.SFM_MODEL
        elif DataSource.DATABASE in self.sources:
            self.active_source = DataSource.DATABASE

    def get_available_sources(self) -> List[str]:
        """Returns a list of names of the available data sources."""
        return [source.value for source in self.sources]

    def set_active_source(self, source_name: str) -> bool:
        """Sets the active data source."""
        try:
            source_to_set = DataSource(source_name)
            if source_to_set in self.sources:
                self.active_source = source_to_set
                return True
            return False
        except ValueError:
            return False

    def has_reprojection_data(self) -> bool:
        """Whether a sparse model supplies registered camera poses."""
        return bool(
            self.reconstruction
            and self.reconstruction.images
        )

    def touch_geometry_stream(self, request_stream: str = "default"):
        self._geometry_store.touch(request_stream)

    def supersede_reprojection_render(self, request_stream: str = "default"):
        self._renderer.supersede(request_stream)

    def release_geometry_stream(self, request_stream: str = "default"):
        self._geometry_store.release(request_stream)

    def begin_external_geometry_upload(
        self,
        request_stream: str = "default",
        client_generation: Optional[int] = None,
    ) -> int:
        return self._geometry_store.begin_upload(
            request_stream, client_generation
        )

    def cancel_external_geometry_upload(
        self, request_stream: str, upload_token: int
    ):
        self._geometry_store.cancel_upload(request_stream, upload_token)

    def get_geometry_status(
        self, request_stream: str = "default"
    ) -> Dict[str, Any]:
        colmap_count = len(self.reconstruction.points3D) if self.reconstruction else 0
        return self._geometry_store.status(request_stream, colmap_count)

    def load_external_geometry(
        self,
        path: str,
        display_name: Optional[str] = None,
        request_stream: str = "default",
        as_default: bool = False,
        upload_token: Optional[int] = None,
        configured_token: Optional[str] = None,
    ):
        if os.path.splitext(path)[1].lower() != ".ply":
            raise ValueError("External geometry must be a .ply file")
        stream = self._request_stream(request_stream)
        if not as_default and upload_token is None:
            upload_token = self.begin_external_geometry_upload(stream)
        try:
            if not as_default:
                self._geometry_store.require_current_upload(stream, upload_token)
            points, colors, kind = self._ply_loader.load(path)
            content_hash = hashlib.sha256()
            with open(path, "rb") as geometry_file:
                for chunk in iter(lambda: geometry_file.read(1024 * 1024), b""):
                    content_hash.update(chunk)
            points.setflags(write=False)
            colors.setflags(write=False)
            geometry = GeometryData(
                xyz=points,
                rgb=colors,
                name=display_name or os.path.basename(path),
                kind=kind,
                revision=self._geometry_store.next_revision(),
                cache_token=content_hash.hexdigest()[:16],
            )
            if as_default:
                if configured_token is None:
                    self._geometry_store.set_default(geometry)
                else:
                    with self._configured_geometry_lock:
                        if (
                            not self.geometry_path
                            or self.geometry_path != path
                            or not hmac.compare_digest(
                                configured_token, self._geometry_file_token
                            )
                        ):
                            raise ValueError(
                                "Configured geometry selection has changed"
                            )
                        self._geometry_store.set_default(geometry)
            else:
                self._geometry_store.install(stream, upload_token, geometry)
        finally:
            if not as_default:
                self.cancel_external_geometry_upload(stream, upload_token)
        status_stream = request_stream if not as_default else "default"
        return self.get_geometry_status(status_stream)

    def reset_external_geometry(self, request_stream: str = "default"):
        self._geometry_store.reset_to_colmap(request_stream)
        self.start_reprojection_warmup()
        return self.get_geometry_status(request_stream)

    def start_reprojection_warmup(self):
        """Build compact geometry arrays in the background before first use."""
        if not self.has_reprojection_data():
            return
        with self._geometry_build_lock:
            if self._colmap_geometry is not None or self._warmup_started:
                return
            self._warmup_started = True
        threading.Thread(
            target=self._ensure_geometry_arrays,
            name="colmap-reprojection-warmup",
            daemon=True,
        ).start()

    def get_reprojection_images(self) -> List[Dict[str, Any]]:
        """Images available to geometry-only reprojection mode.

        This deliberately reads from the reconstruction rather than the active
        match source, because a database contains no registered camera poses.
        """
        if not self.reconstruction:
            return []
        result = []
        for image_id, image in self.reconstruction.images.items():
            camera = self.reconstruction.cameras[image.camera_id]
            pose_accessor = image.cam_from_world
            pose = pose_accessor() if callable(pose_accessor) else pose_accessor
            result.append({
                "id": int(image_id),
                "name": image.name,
                "width": int(camera.width),
                "height": int(camera.height),
                "camera": {
                    "model": camera.model_name,
                    "params": np.asarray(camera.params, dtype=np.float64).tolist(),
                },
                "cam_from_world": np.asarray(
                    pose.matrix(), dtype=np.float64
                ).tolist(),
            })
        return sorted(result, key=lambda item: item["name"])

    def iter_colmap_points_ply(
        self, chunk_size: int = 100_000
    ) -> Iterator[bytes]:
        """Yield the reconstruction points as a packed binary PLY stream."""
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        geometry = self._ensure_geometry_arrays()
        count = len(geometry.xyz)
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {count}\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property uchar red\n"
            "property uchar green\n"
            "property uchar blue\n"
            "end_header\n"
        ).encode("ascii")
        yield header
        vertex_dtype = np.dtype([
            ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
            ("red", "u1"), ("green", "u1"), ("blue", "u1"),
        ])
        for start in range(0, count, chunk_size):
            stop = min(count, start + chunk_size)
            vertices = np.empty(stop - start, dtype=vertex_dtype)
            vertices["x"] = geometry.xyz[start:stop, 0]
            vertices["y"] = geometry.xyz[start:stop, 1]
            vertices["z"] = geometry.xyz[start:stop, 2]
            vertices["red"] = geometry.rgb[start:stop, 0]
            vertices["green"] = geometry.rgb[start:stop, 1]
            vertices["blue"] = geometry.rgb[start:stop, 2]
            yield vertices.tobytes()

    def _get_reprojection_image(self, image_id: int):
        if not self.reconstruction or image_id not in self.reconstruction.images:
            raise KeyError(f"Unknown reconstruction image ID: {image_id}")
        image = self.reconstruction.images[image_id]
        camera = self.reconstruction.cameras[image.camera_id]
        return image, camera

    def _source_image_path(self, image_name: str) -> str:
        # Validate the lexical path before following symlinks. A symlink stored
        # inside the configured image tree is intentional and may legitimately
        # resolve to a shared image directory outside that tree.
        image_root = os.path.abspath(self.image_base_path)
        image_path = os.path.abspath(os.path.join(image_root, image_name))
        if os.path.commonpath([image_root, image_path]) != image_root:
            raise ValueError("Image path escapes the configured image directory")
        if not os.path.isfile(image_path):
            raise FileNotFoundError(image_path)
        return image_path

    @staticmethod
    def _encode_jpeg(array: np.ndarray, high_quality: bool = False) -> bytes:
        output = io.BytesIO()
        Image.fromarray(array, "RGB").save(
            output,
            format="JPEG",
            quality=95 if high_quality else 90,
            subsampling=0 if high_quality else 2,
            optimize=False,
        )
        return output.getvalue()

    def _cache_get(self, key: tuple) -> Optional[bytes]:
        return self._png_cache.get(key)

    def _cache_put(self, key: tuple, value: bytes) -> bytes:
        return self._png_cache.put(key, value)

    @staticmethod
    def _request_stream(request_stream: str) -> str:
        # Bound both key size and the number of retained browser tabs. The
        # frontend uses a UUID, while "default" preserves API compatibility.
        return (request_stream or "default")[:128]

    def _new_input_request(self, request_stream: str) -> int:
        return self._input_requests.begin(request_stream)

    def _check_input_request(self, request_stream: str, request_id: int):
        self._input_requests.check(request_stream, request_id)

    def get_reprojection_input_image(
        self,
        image_id: int,
        max_size: int = 1600,
        request_stream: str = "default",
    ) -> bytes:
        """Decode stored pixels without applying EXIF orientation."""
        self.touch_geometry_stream(request_stream)
        cache_key = ("input-jpeg", image_id, max_size)
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        request_id = self._new_input_request(request_stream)
        image, camera = self._get_reprojection_image(image_id)
        if not (ReprojectionRenderer.MIN_PREVIEW_SIZE
                <= max_size <= self.MAX_INPUT_SIZE):
            raise ValueError(
                "input max_size must be between "
                f"{ReprojectionRenderer.MIN_PREVIEW_SIZE} and {self.MAX_INPUT_SIZE}"
            )
        scale = min(1.0, max_size / max(camera.width, camera.height))
        width = max(1, round(camera.width * scale))
        height = max(1, round(camera.height * scale))
        with self._input_lock:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached
            self._check_input_request(request_stream, request_id)
            with Image.open(self._source_image_path(image.name)) as source:
                native_size = source.size
                if native_size != (camera.width, camera.height):
                    raise ValueError(
                        f"Image raster is {native_size}, but camera expects "
                        f"{(camera.width, camera.height)}"
                    )
                # JPEG decoders can downsample by 2/4/8 while decoding. For the
                # high-resolution fisheye images this avoids constructing and
                # resampling the full 30-megapixel raster.
                source.draft("RGB", (width, height))
                source.load()
                self._check_input_request(request_stream, request_id)
                if source.size != (width, height):
                    source = source.resize((width, height), Image.Resampling.BILINEAR)
                pixels = np.asarray(source.convert("RGB"))
            self._check_input_request(request_stream, request_id)
            return self._cache_put(
                cache_key,
                self._encode_jpeg(pixels, high_quality=max_size > 1600),
            )

    def _ensure_geometry_arrays(self) -> GeometryData:
        if self._colmap_geometry is not None:
            return self._colmap_geometry
        with self._geometry_build_lock:
            if self._colmap_geometry is not None:
                return self._colmap_geometry
            if not self.reconstruction:
                raise ValueError("A sparse reconstruction is required")
            # Only xyz and color are read. Point tracks are never consulted.
            points = list(self.reconstruction.points3D.values())
            xyz = np.asarray(
                [point.xyz for point in points], dtype=np.float32
            ).reshape(-1, 3)
            rgb = np.asarray(
                [point.color for point in points], dtype=np.uint8
            ).reshape(-1, 3)
            xyz.setflags(write=False)
            rgb.setflags(write=False)
            self._colmap_geometry = GeometryData(
                xyz=xyz,
                rgb=rgb,
                name="COLMAP points3D",
                kind="colmap",
                revision=0,
                cache_token="colmap",
            )
            return self._colmap_geometry

    def _geometry_for_stream(self, request_stream: str) -> GeometryData:
        geometry = self._geometry_store.selected(request_stream)
        if geometry is not None:
            return geometry
        return self._ensure_geometry_arrays()

    def get_reprojection_render_png(
        self,
        image_id: int,
        max_size: int = 1600,
        color_mode: str = "rgb",
        radius: int = 1,
        request_stream: str = "default",
        region: Optional[tuple] = None,
        clip_frame: bool = False,
        depth_range: Optional[tuple] = None,
        depth_fractions: Optional[tuple] = None,
    ) -> bytes:
        """Render the selected geometry through a reconstruction camera."""
        geometry = self._geometry_for_stream(request_stream)
        image, camera = self._get_reprojection_image(image_id)
        return self._renderer.render_png(
            image_id=image_id,
            image=image,
            camera=camera,
            geometry=geometry,
            max_size=max_size,
            color_mode=color_mode,
            radius=radius,
            request_stream=request_stream,
            region=region,
            clip_frame=clip_frame,
            depth_range=depth_range,
            depth_fractions=depth_fractions,
        )

    def _get_images_from_recon(self) -> List[Dict[str, Any]]:
        if not self.reconstruction:
            return []
        images_list = []
        for image_id, image in self.reconstruction.images.items():
            camera = self.reconstruction.cameras[image.camera_id]
            images_list.append({
                "id": image_id,
                "name": image.name,
                "width": camera.width,
                "height": camera.height,
                "path": os.path.join(self.image_base_path, image.name)
            })
        return images_list

    def _get_images_from_db(self) -> List[Dict[str, Any]]:
        if not self.db:
            return []
        images_list = []
        for image in self.db.read_all_images():
            camera = self.db.read_camera(image.camera_id)
            images_list.append({
                "id": int(image.image_id),
                "name": str(image.name),
                "width": int(camera.width),
                "height": int(camera.height),
                "path": os.path.join(self.image_base_path, str(image.name))
            })
        return images_list

    def get_images(self) -> List[Dict[str, Any]]:
        """Returns a list of all images from the active source."""
        if self.active_source == DataSource.SFM_MODEL:
            return self._get_images_from_recon()
        elif self.active_source == DataSource.DATABASE:
            return self._get_images_from_db()
        return []

    def _get_image_data_from_recon(self, image_id: int) -> Optional[Dict[str, Any]]:
        if not self.reconstruction or image_id not in self.reconstruction.images:
            return None
        
        image = self.reconstruction.images[image_id]
        camera = self.reconstruction.cameras[image.camera_id]

        points2D_list = []
        for p in image.points2D:
            point3D_id = p.point3D_id
            points2D_list.append({
                "x": float(p.x()),
                "y": float(p.y()),
                "point3D_id": int(point3D_id) if point3D_id != 18446744073709551615 else None
            })

        return {
            "id": image_id,
            "name": image.name,
            "width": camera.width,
            "height": camera.height,
            "path": os.path.join(self.image_base_path, image.name),
            "points2D": points2D_list,
            "camera_params": camera.params.tolist()
        }

    def _get_image_data_from_db(self, image_id: int) -> Optional[Dict[str, Any]]:
        if not self.db:
            return None

        image = self.db.read_image(image_id)
        if not image:
            return None
            
        camera = self.db.read_camera(image.camera_id)
        keypoints = self.db.read_keypoints(image_id)

        points2D_list = []
        for p in keypoints:
            points2D_list.append({
                "x": float(p[0]),
                "y": float(p[1]),
                "point3D_id": None
            })

        return {
            "id": int(image.image_id),
            "name": str(image.name),
            "width": int(camera.width),
            "height": int(camera.height),
            "path": os.path.join(self.image_base_path, str(image.name)),
            "points2D": points2D_list,
            "camera_params": list(camera.params)
        }

    def get_image_data(self, image_id: int) -> Optional[Dict[str, Any]]:
        """Returns the data for a single image from the active source."""
        if self.active_source == DataSource.SFM_MODEL:
            return self._get_image_data_from_recon(image_id)
        elif self.active_source == DataSource.DATABASE:
            return self._get_image_data_from_db(image_id)
        return None

    def get_epipolar_geometry(self, image_id1: int, image_id2: int) -> Dict[str, Any]:
        """Return pose-derived straight-line epipolar geometry for an image pair."""
        if self.active_source != DataSource.SFM_MODEL or not self.reconstruction:
            raise ValueError(
                "Epipolar pose inspection requires an SfM model with registered poses"
            )
        if image_id1 not in self.reconstruction.images:
            raise KeyError(image_id1)
        if image_id2 not in self.reconstruction.images:
            raise KeyError(image_id2)
        image1 = self.reconstruction.images[image_id1]
        image2 = self.reconstruction.images[image_id2]
        camera1 = self.reconstruction.cameras[image1.camera_id]
        camera2 = self.reconstruction.cameras[image2.camera_id]
        matrix = fundamental_matrix(image1, camera1, image2, camera2)
        return {
            "fundamental_matrix": matrix.tolist(),
            "image1": {"width": int(camera1.width), "height": int(camera1.height)},
            "image2": {"width": int(camera2.width), "height": int(camera2.height)},
        }

    def get_pair_candidates(
        self, image_id: int, max_pose_neighbors: int = DEFAULT_POSE_NEIGHBORS
    ) -> Dict[str, Any]:
        """Return pair candidates from the currently selected data source."""
        if self.active_source == DataSource.DATABASE:
            return {
                "image_ids": self._get_database_pair_candidates(image_id),
                "source": "matches",
            }
        if self.active_source == DataSource.SFM_MODEL:
            return self._get_reconstruction_pair_candidates(
                image_id, max_pose_neighbors
            )
        return {"image_ids": [], "source": "none"}

    def _get_database_pair_candidates(self, image_id: int) -> List[int]:
        if not self.db:
            return []
        matched_image_ids = []
        for other_image_id in (image["id"] for image in self.get_images()):
            if image_id == other_image_id:
                continue
            if not self.db.exists_matches(image_id, other_image_id):
                continue
            matches = self.db.read_matches(image_id, other_image_id)
            try:
                has_matches = matches is not None and len(matches) > 0
            except TypeError:
                # Some pycolmap versions return objects without __len__.
                has_matches = getattr(matches, "size", 0) > 0
            if has_matches:
                matched_image_ids.append(other_image_id)
        return matched_image_ids

    def _get_reconstruction_pair_candidates(
        self, image_id: int, max_pose_neighbors: int
    ) -> Dict[str, Any]:
        if not self.reconstruction:
            return {"image_ids": [], "source": "none"}
        track_neighbors = self._get_track_neighbors_from_recon(image_id)
        if track_neighbors:
            return {"image_ids": track_neighbors, "source": "tracks"}
        limit = max(1, min(self.MAX_POSE_NEIGHBORS, int(max_pose_neighbors)))
        return {
            "image_ids": self._get_pose_neighbor_index().candidates(image_id, limit),
            "source": "pose_neighbors",
        }

    def get_matches_for_image(
        self, image_id: int, max_pose_neighbors: int = DEFAULT_POSE_NEIGHBORS
    ) -> List[int]:
        """Return observed pair IDs, or pose neighbors when observations are absent."""
        return self.get_pair_candidates(image_id, max_pose_neighbors)["image_ids"]

    def _get_track_neighbors_from_recon(self, image_id: int) -> List[int]:
        if not self.reconstruction or image_id not in self.reconstruction.images:
            return []

        image = self.reconstruction.images[image_id]
        observed_points3D = {p.point3D_id for p in image.points2D if p.has_point3D()}

        matched_image_ids = set()
        for p3D_id in observed_points3D:
            point3D = self.reconstruction.points3D[p3D_id]
            for track_element in point3D.track.elements:
                if track_element.image_id != image_id:
                    matched_image_ids.add(track_element.image_id)

        return sorted(matched_image_ids)

    def _get_pose_neighbor_index(self) -> PoseNeighborIndex:
        if self._pose_neighbor_index is not None:
            return self._pose_neighbor_index
        with self._pose_neighbor_lock:
            if self._pose_neighbor_index is None:
                if not self.reconstruction:
                    raise ValueError("An SfM reconstruction is required")
                self._pose_neighbor_index = PoseNeighborIndex.from_reconstruction(
                    self.reconstruction
                )
            return self._pose_neighbor_index

    def get_matches(self, image_id1: int, image_id2: int, match_type: Optional[str] = None) -> Optional[List]:
        """Returns the matches between two images."""
        if self.db:
            try:
                all_matches = self.db.read_matches(image_id1, image_id2)
                if all_matches is None:
                    return None
                all_matches = all_matches.tolist()

                two_view_geometry = self.db.read_two_view_geometry(image_id1, image_id2)
                inlier_matches = []
                if two_view_geometry and two_view_geometry.inlier_matches is not None:
                    inlier_matches = two_view_geometry.inlier_matches.tolist()

                if match_type == "inlier":
                    return inlier_matches
                elif match_type == "outlier":
                    # Calculate outlier matches
                    inlier_set = set(tuple(m) for m in inlier_matches)
                    outlier_matches = [m for m in all_matches if tuple(m) not in inlier_set]
                    return outlier_matches
                else:  # None or "all"
                    return all_matches
            except Exception as e:
                print(f"Error reading matches from database: {e}")
                return None
        elif self.reconstruction:
            if match_type == "outlier":
                return []
            else:
                return self._get_matches_from_recon(image_id1, image_id2)
        return None

    def _get_matches_from_recon(self, image_id1: int, image_id2: int) -> Optional[List]:
        if not self.reconstruction or image_id1 not in self.reconstruction.images or image_id2 not in self.reconstruction.images:
            return None

        image1 = self.reconstruction.images[image_id1]
        image2 = self.reconstruction.images[image_id2]

        points1_map = {p.point3D_id: i for i, p in enumerate(image1.points2D) if p.has_point3D()}

        matches = []
        for i2, p2 in enumerate(image2.points2D):
            if p2.has_point3D() and p2.point3D_id in points1_map:
                i1 = points1_map[p2.point3D_id]
                matches.append([i1, i2])

        return matches

    def get_match_summary(self, image_id1: int, image_id2: int) -> Dict[str, Any]:
        if self.active_source == DataSource.SFM_MODEL:
            matches = self._get_matches_from_recon(image_id1, image_id2)
            return {
                "available": True,
                "total_matches": len(matches) if matches is not None else 0,
                "inlier_count": None,
                "outlier_count": None,
                "two_view_configuration": None,
                "two_view_configuration_id": None,
                "two_view_geometry_available": False,
                "reason": None
            }

        if self.active_source != DataSource.DATABASE or not self.db:
            return {
                "available": False,
                "reason": "Two-view geometry details are only available when using a COLMAP database data source."
            }

        matches = None
        try:
            matches = self.db.read_matches(image_id1, image_id2)
        except Exception as exc:
            return {
                "available": False,
                "reason": f"Unable to read matches from database: {exc}",
                "total_matches": None,
                "inlier_count": None,
                "outlier_count": None,
                "two_view_configuration": None,
                "two_view_configuration_id": None,
                "two_view_geometry_available": False,
            }

        total_matches = 0
        if matches is not None:
            try:
                total_matches = len(matches)
            except TypeError:
                total_matches = getattr(matches, "size", 0) or 0

        two_view_geometry = None
        two_view_error: Optional[str] = None
        try:
            two_view_geometry = self.db.read_two_view_geometry(image_id1, image_id2)
        except Exception as exc:
            two_view_error = str(exc)

        inlier_count = None
        configuration = None
        configuration_id = None

        if two_view_geometry is not None:
            configuration_id = getattr(two_view_geometry, "config", None)
            configuration = TWO_VIEW_CONFIGURATION_LABELS.get(configuration_id, "Unknown")
            inlier_matches = getattr(two_view_geometry, "inlier_matches", None)
            if inlier_matches is not None:
                try:
                    inlier_count = len(inlier_matches)
                except TypeError:
                    if hasattr(inlier_matches, "shape") and len(inlier_matches.shape) > 0:
                        inlier_count = inlier_matches.shape[0]
                    else:
                        inlier_count = None

        outlier_count = None
        if total_matches is not None and inlier_count is not None:
            outlier_count = max(total_matches - inlier_count, 0)

        has_two_view_info = two_view_geometry is not None

        summary: Dict[str, Any] = {
            "available": True,
            "total_matches": total_matches,
            "inlier_count": inlier_count,
            "outlier_count": outlier_count,
            "two_view_configuration": configuration if has_two_view_info else None,
            "two_view_configuration_id": configuration_id,
            "two_view_geometry_available": has_two_view_info,
        }

        if two_view_error:
            summary["two_view_geometry_available"] = False
            summary["reason"] = f"Unable to read two-view geometry from database: {two_view_error}"
        elif not has_two_view_info:
            summary["two_view_geometry_available"] = False
            summary["reason"] = "No two-view geometry entry found in database for this image pair."

        return summary
