import pycolmap
import os
import io
import hashlib
import threading
from collections import OrderedDict
from typing import List, Dict, Any, Optional
from enum import Enum

import numpy as np
import cv2
import numexpr as ne
from PIL import Image


class RenderSuperseded(RuntimeError):
    """Raised when a newer cold projection request replaces this one."""


class InputSuperseded(RuntimeError):
    """Raised when a newer source-image request replaces this one."""


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
    def __init__(self, image_path: str, project_path: Optional[str] = None, db_path: Optional[str] = None):
        self.image_base_path = image_path
        self.project_path = project_path
        self.db_path = db_path
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
        self._xyz: Optional[np.ndarray] = None
        self._rgb: Optional[np.ndarray] = None
        self._geometry_lock = threading.Lock()
        self._render_lock = threading.Lock()
        self._render_request_lock = threading.Lock()
        self._render_request_sequence = 0
        self._latest_render_requests = OrderedDict()
        self._input_lock = threading.Lock()
        self._input_request_lock = threading.Lock()
        self._input_request_sequence = 0
        self._latest_input_requests = OrderedDict()
        self._cache_lock = threading.Lock()
        self._warmup_started = False
        self._png_cache: Dict[tuple, bytes] = {}
        self._png_cache_order: List[tuple] = []
        self._splat_cache: Dict[tuple, tuple] = {}
        self._splat_cache_order: List[tuple] = []

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
        """Whether a sparse model with poses and points can be reprojected."""
        return bool(
            self.reconstruction
            and self.reconstruction.images
            and self.reconstruction.points3D
        )

    def start_reprojection_warmup(self):
        """Build compact geometry arrays in the background before first use."""
        if not self.has_reprojection_data():
            return
        with self._geometry_lock:
            if self._xyz is not None or self._warmup_started:
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
            result.append({
                "id": int(image_id),
                "name": image.name,
                "width": int(camera.width),
                "height": int(camera.height),
            })
        return sorted(result, key=lambda item: item["name"])

    def _get_reprojection_image(self, image_id: int):
        if not self.reconstruction or image_id not in self.reconstruction.images:
            raise KeyError(f"Unknown reconstruction image ID: {image_id}")
        image = self.reconstruction.images[image_id]
        camera = self.reconstruction.cameras[image.camera_id]
        return image, camera

    def _preview_geometry(self, camera, max_size: int):
        if not 320 <= max_size <= 4096:
            raise ValueError("max_size must be between 320 and 4096")
        scale = min(1.0, max_size / max(camera.width, camera.height))
        width = max(1, round(camera.width * scale))
        height = max(1, round(camera.height * scale))
        return width, height, scale

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
    def _encode_png(array: np.ndarray) -> bytes:
        output = io.BytesIO()
        Image.fromarray(array, "RGB").save(output, format="PNG", compress_level=2)
        return output.getvalue()

    @staticmethod
    def _encode_jpeg(array: np.ndarray) -> bytes:
        output = io.BytesIO()
        Image.fromarray(array, "RGB").save(
            output, format="JPEG", quality=90, subsampling=2, optimize=False
        )
        return output.getvalue()

    def _cache_get(self, key: tuple) -> Optional[bytes]:
        with self._cache_lock:
            return self._png_cache.get(key)

    def _cache_put(self, key: tuple, value: bytes) -> bytes:
        with self._cache_lock:
            if key in self._png_cache:
                self._png_cache_order.remove(key)
            self._png_cache[key] = value
            self._png_cache_order.append(key)
            while len(self._png_cache_order) > 20:
                oldest = self._png_cache_order.pop(0)
                self._png_cache.pop(oldest, None)
        return value

    def _splat_cache_get(self, key: tuple):
        with self._cache_lock:
            value = self._splat_cache.get(key)
            if value is not None:
                self._splat_cache_order.remove(key)
                self._splat_cache_order.append(key)
            return value

    def _splat_cache_put(self, key: tuple, value: tuple):
        with self._cache_lock:
            if key in self._splat_cache:
                self._splat_cache_order.remove(key)
            self._splat_cache[key] = value
            self._splat_cache_order.append(key)
            # Packed depth/source buffers are intentionally limited: each one
            # is roughly 20 MB at the default preview resolution.
            while len(self._splat_cache_order) > 2:
                oldest = self._splat_cache_order.pop(0)
                self._splat_cache.pop(oldest, None)

    @staticmethod
    def _request_stream(request_stream: str) -> str:
        # Bound both key size and the number of retained browser tabs. The
        # frontend uses a UUID, while "default" preserves API compatibility.
        return (request_stream or "default")[:128]

    @staticmethod
    def _remember_latest_request(requests, stream: str, request_id: int):
        requests[stream] = request_id
        requests.move_to_end(stream)
        while len(requests) > 256:
            requests.popitem(last=False)

    def _new_render_request(self, request_stream: str) -> int:
        stream = self._request_stream(request_stream)
        with self._render_request_lock:
            self._render_request_sequence += 1
            request_id = self._render_request_sequence
            self._remember_latest_request(
                self._latest_render_requests, stream, request_id
            )
            return request_id

    def _check_render_request(self, request_stream: str, request_id: int):
        stream = self._request_stream(request_stream)
        with self._render_request_lock:
            if request_id != self._latest_render_requests.get(stream):
                raise RenderSuperseded()

    def _new_input_request(self, request_stream: str) -> int:
        stream = self._request_stream(request_stream)
        with self._input_request_lock:
            self._input_request_sequence += 1
            request_id = self._input_request_sequence
            self._remember_latest_request(
                self._latest_input_requests, stream, request_id
            )
            return request_id

    def _check_input_request(self, request_stream: str, request_id: int):
        stream = self._request_stream(request_stream)
        with self._input_request_lock:
            if request_id != self._latest_input_requests.get(stream):
                raise InputSuperseded()

    def get_reprojection_input_image(
        self,
        image_id: int,
        max_size: int = 1600,
        request_stream: str = "default",
    ) -> bytes:
        """Decode stored pixels without applying EXIF orientation."""
        cache_key = ("input-jpeg", image_id, max_size)
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        request_id = self._new_input_request(request_stream)
        image, camera = self._get_reprojection_image(image_id)
        width, height, _ = self._preview_geometry(camera, max_size)
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
            return self._cache_put(cache_key, self._encode_jpeg(pixels))

    def _ensure_geometry_arrays(self):
        if self._xyz is not None:
            return
        with self._geometry_lock:
            if self._xyz is not None:
                return
            if not self.reconstruction:
                raise ValueError("A sparse reconstruction is required")
            # Only xyz and color are read. Point tracks are never consulted.
            points = list(self.reconstruction.points3D.values())
            self._xyz = np.asarray([point.xyz for point in points], dtype=np.float32)
            self._rgb = np.asarray([point.color for point in points], dtype=np.uint8)

    @staticmethod
    def _depth_colors(depth: np.ndarray) -> np.ndarray:
        """Small dependency-free blue/cyan/yellow/red depth palette."""
        low, high = np.percentile(depth, [2, 98])
        value = np.clip((depth - low) / max(float(high - low), 1e-6), 0, 1)
        anchors = np.asarray([
            [255, 40, 40],
            [255, 220, 30],
            [20, 220, 220],
            [40, 80, 255],
        ], dtype=np.float32)
        position = value * (len(anchors) - 1)
        left = np.floor(position).astype(np.int64)
        right = np.minimum(left + 1, len(anchors) - 1)
        blend = (position - left)[:, None]
        return np.uint8(anchors[left] * (1 - blend) + anchors[right] * blend)

    def _get_reprojection_base(
        self,
        image_id: int,
        max_size: int,
        color_mode: str,
        need_splat_data: bool = False,
        request_stream: str = "default",
    ):
        """Return a one-pixel PNG or its cached depth-aware splat buffers."""
        cache_key = ("render-base", image_id, max_size, color_mode)
        splat_key = (image_id, max_size, color_mode)
        cached = self._cache_get(cache_key)
        splat_cached = self._splat_cache_get(splat_key)
        if need_splat_data:
            if splat_cached is not None:
                return splat_cached
        elif cached is not None:
            return cached
        elif splat_cached is not None:
            encoded = self._encode_png(splat_cached[0])
            return self._cache_put(cache_key, encoded)

        request_id = self._new_render_request(request_stream)
        self._ensure_geometry_arrays()
        self._check_render_request(request_stream, request_id)
        image, camera = self._get_reprojection_image(image_id)
        width, height, scale = self._preview_geometry(camera, max_size)

        # Avoid simultaneous transforms of a multi-million-point cloud.
        with self._render_lock:
            cached = self._cache_get(cache_key)
            splat_cached = self._splat_cache_get(splat_key)
            if need_splat_data:
                if splat_cached is not None:
                    return splat_cached
            elif cached is not None:
                return cached
            elif splat_cached is not None:
                encoded = self._encode_png(splat_cached[0])
                return self._cache_put(cache_key, encoded)
            # Requests waiting behind the lock are cheap to discard. Only the
            # most recently requested camera is allowed to start projection.
            self._check_render_request(request_stream, request_id)
            pose_accessor = image.cam_from_world
            pose = pose_accessor() if callable(pose_accessor) else pose_accessor
            matrix = np.asarray(pose.matrix(), dtype=np.float32)
            xyz_camera = self._xyz @ matrix[:, :3].T + matrix[:, 3]
            self._check_render_request(request_stream, request_id)
            z = xyz_camera[:, 2]
            is_pinhole = camera.model_name in {"PINHOLE", "SIMPLE_PINHOLE"}
            # Exact pre-projection frustum test for the pinhole models. This
            # avoids running camera projection for off-screen positive-depth
            # points (all cameras in the current dataset are PINHOLE).
            if is_pinhole:
                if camera.model_name == "PINHOLE":
                    fx, fy, cx, cy = camera.params
                else:
                    fx, cx, cy = camera.params
                    fy = fx
                x_world_camera = xyz_camera[:, 0]
                y_world_camera = xyz_camera[:, 1]
                # Match the final preview-pixel bounds exactly so no second
                # in-frame filtering/copy is needed after projection.
                left = ((-0.5 / scale) - cx) / fx
                right = (((width - 0.5) / scale) - cx) / fx
                top = ((-0.5 / scale) - cy) / fy
                bottom = (((height - 0.5) / scale) - cy) / fy
                visible = ne.evaluate(
                    "(z > 1e-6) & (x_world_camera >= left*z) "
                    "& (x_world_camera < right*z) "
                    "& (y_world_camera >= top*z) "
                    "& (y_world_camera < bottom*z)"
                )
            else:
                visible = z > 1e-6
            xyz_camera = xyz_camera[visible]
            colors = self._rgb[visible]

            canvas = np.zeros((height, width, 3), dtype=np.uint8)
            zbuffer = np.full(height * width, np.inf, dtype=np.float32)
            if len(xyz_camera):
                if is_pinhole:
                    x_camera = xyz_camera[:, 0]
                    y_camera = xyz_camera[:, 1]
                    depth = xyz_camera[:, 2]
                    u = ne.evaluate("(fx*x_camera/depth + cx)*scale")
                    v = ne.evaluate("(fy*y_camera/depth + cy)*scale")
                    x = np.rint(u).astype(np.int64, copy=False)
                    y = np.rint(v).astype(np.int64, copy=False)
                    # Only floating-point boundary noise can reach the clamp;
                    # the fused frustum test above already enforces bounds.
                    np.clip(x, 0, width - 1, out=x)
                    np.clip(y, 0, height - 1, out=y)
                else:
                    # pycolmap handles arbitrary distorted/fisheye models.
                    uv = np.asarray(camera.img_from_cam(xyz_camera), dtype=np.float32) * scale
                    finite = np.isfinite(uv).all(axis=1)
                    uv, xyz_camera, colors = uv[finite], xyz_camera[finite], colors[finite]
                    x = np.rint(uv[:, 0]).astype(np.int64, copy=False)
                    y = np.rint(uv[:, 1]).astype(np.int64, copy=False)
                    inside = (x >= 0) & (x < width) & (y >= 0) & (y < height)
                    x, y = x[inside], y[inside]
                    depth = xyz_camera[inside, 2]
                    colors = colors[inside]
                self._check_render_request(request_stream, request_id)

                if len(depth):
                    pixel = y * width + x
                    np.minimum.at(zbuffer, pixel, depth)
                    front = depth <= zbuffer[pixel] * (1.0 + 1e-6)
                    pixel, depth, colors = pixel[front], depth[front], colors[front]
                    if color_mode == "depth":
                        colors = self._depth_colors(depth)
                    elif color_mode == "white":
                        colors = np.full_like(colors, 255)
                    canvas.reshape(-1, 3)[pixel] = colors

            self._check_render_request(request_stream, request_id)
            # Positive IEEE-754 float bits preserve depth ordering. Packing the
            # depth bits with the source pixel index lets OpenCV morphology
            # return both the nearest depth and the exact winning color source.
            pixel_count = width * height
            source_modulus = pixel_count + 1
            index_bits = source_modulus.bit_length()
            depth_bits = max(8, 53 - index_bits)
            depth_shift = max(0, 31 - depth_bits)
            sentinel_rank = 2**depth_bits - 1
            sentinel = sentinel_rank * source_modulus + pixel_count
            packed = np.full(pixel_count, float(sentinel), dtype=np.float64)
            finite_depth = np.isfinite(zbuffer)
            source_pixels = np.flatnonzero(finite_depth).astype(np.int64)
            if len(source_pixels):
                depth_rank = (
                    zbuffer[finite_depth].view(np.uint32).astype(np.int64)
                    >> depth_shift
                )
                packed[source_pixels] = (
                    depth_rank * source_modulus + source_pixels
                ).astype(np.float64)
            splat_data = (
                canvas,
                packed.reshape(height, width),
                float(sentinel),
                source_modulus,
            )
            self._splat_cache_put(splat_key, splat_data)
            if need_splat_data:
                # Return the strong local reference. Another request may evict
                # this entry immediately after the render lock is released.
                return splat_data
            return self._cache_put(cache_key, self._encode_png(canvas))

    def get_reprojection_render_png(
        self,
        image_id: int,
        max_size: int = 1600,
        color_mode: str = "rgb",
        radius: int = 1,
        request_stream: str = "default",
    ) -> bytes:
        """Project every point, reusing projection when only size changes."""
        if color_mode not in {"rgb", "depth", "white"}:
            raise ValueError("color_mode must be rgb, depth, or white")
        if not 0 <= radius <= 7:
            raise ValueError("radius must be between 0 and 7")

        cache_key = ("render-sized", image_id, max_size, color_mode, radius)
        if radius > 0:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        base = self._get_reprojection_base(
            image_id,
            max_size,
            color_mode,
            need_splat_data=radius > 0,
            request_stream=request_stream,
        )
        if radius == 0:
            return base

        # Expand packed depth/source keys, not RGB values. Erosion selects the
        # nearest source point over every enlarged footprint, then its original
        # color is copied. Thus point-size changes remain depth-tested.
        base_color, packed, sentinel, source_modulus = base
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)
        )
        winners = cv2.erode(
            packed,
            kernel,
            borderType=cv2.BORDER_CONSTANT,
            borderValue=sentinel,
        ).reshape(-1)
        valid = winners < sentinel
        winner_pixels = winners[valid].astype(np.int64) % source_modulus
        canvas = np.zeros_like(base_color)
        canvas.reshape(-1, 3)[valid] = base_color.reshape(-1, 3)[winner_pixels]
        return self._cache_put(cache_key, self._encode_png(canvas))

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

    def get_matches_for_image(self, image_id: int) -> List[int]:
        """Returns a list of image IDs that have matches with the given image ID."""
        if self.db:
            all_images = self.get_images()
            image_ids = {img['id'] for img in all_images}
            matched_image_ids = []
            for other_image_id in image_ids:
                if image_id == other_image_id:
                    continue

                if not self.db.exists_matches(image_id, other_image_id):
                    continue

                matches = self.db.read_matches(image_id, other_image_id)
                if matches is None:
                    continue

                try:
                    has_matches = len(matches) > 0
                except TypeError:
                    # Some pycolmap versions return objects without __len__; fall back to size
                    has_matches = getattr(matches, "size", 0) > 0

                if has_matches:
                    matched_image_ids.append(other_image_id)
            return matched_image_ids
        elif self.reconstruction:
            return self._get_matches_for_image_from_recon(image_id)
        return []

    def _get_matches_for_image_from_recon(self, image_id: int) -> List[int]:
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

        return sorted(list(matched_image_ids))

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
