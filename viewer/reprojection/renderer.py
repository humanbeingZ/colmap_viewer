"""Numerical point-cloud reprojection and depth-aware splatting."""

import io
import threading
from typing import Callable, Optional

import cv2
import numexpr as ne
import numpy as np
from PIL import Image

from .core import (
    BoundedLRUCache,
    GeometryData,
    RenderSuperseded,
    SupersessionTracker,
)


class ReprojectionRenderer:
    """Project XYZ/RGB geometry into COLMAP cameras with a depth buffer."""

    MIN_PREVIEW_SIZE = 320
    MAX_PREVIEW_SIZE = 4096
    BACKGROUND_VERSION = "transparent-v2"

    def __init__(
        self,
        normalize_stream: Callable[[str], str],
        png_cache: Optional[BoundedLRUCache] = None,
    ):
        self._render_lock = threading.Lock()
        self._render_requests = SupersessionTracker(
            RenderSuperseded, normalize_stream
        )
        self._png_cache = png_cache or BoundedLRUCache(20)
        self._splat_cache = BoundedLRUCache(2)

    @staticmethod
    def preview_geometry(camera, max_size: int):
        if not (
            ReprojectionRenderer.MIN_PREVIEW_SIZE
            <= max_size
            <= ReprojectionRenderer.MAX_PREVIEW_SIZE
        ):
            raise ValueError(
                "max_size must be between "
                f"{ReprojectionRenderer.MIN_PREVIEW_SIZE} and "
                f"{ReprojectionRenderer.MAX_PREVIEW_SIZE}"
            )
        # Geometry can be projected above the source image's native
        # resolution. Fractional display-sized points rely on this
        # supersampling before the browser scales the transparent layer down.
        scale = max_size / max(camera.width, camera.height)
        width = max(1, round(camera.width * scale))
        height = max(1, round(camera.height * scale))
        return width, height, scale

    @staticmethod
    def _encode_png(array: np.ndarray) -> bytes:
        output = io.BytesIO()
        mode = "RGBA" if array.shape[2] == 4 else "RGB"
        Image.fromarray(array, mode).save(output, format="PNG", compress_level=2)
        return output.getvalue()

    def _cache_get(self, key: tuple) -> Optional[bytes]:
        return self._png_cache.get(key)

    def _cache_put(self, key: tuple, value: bytes) -> bytes:
        return self._png_cache.put(key, value)

    def _splat_cache_get(self, key: tuple):
        return self._splat_cache.get(key)

    def _splat_cache_put(self, key: tuple, value: tuple):
        # Packed depth/source buffers are intentionally limited: each one is
        # roughly 20 MB at the default preview resolution.
        return self._splat_cache.put(key, value)

    def _new_render_request(self, request_stream: str) -> int:
        return self._render_requests.begin(request_stream)

    def _check_render_request(self, request_stream: str, request_id: int):
        self._render_requests.check(request_stream, request_id)

    def supersede(self, request_stream: str):
        """Cancel any cold projection currently running for one viewer."""
        self._render_requests.begin(request_stream)

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

    @staticmethod
    def _canvas(width: int, height: int) -> np.ndarray:
        """Return a transparent canvas for compositing over the viewer background."""
        return np.zeros((height, width, 4), dtype=np.uint8)

    def _get_reprojection_base(
        self,
        image_id: int,
        image,
        camera,
        max_size: int,
        color_mode: str,
        geometry: GeometryData,
        need_splat_data: bool = False,
        request_stream: str = "default",
        region: Optional[tuple] = None,
        clip_frame: bool = False,
        depth_range: Optional[tuple] = None,
        depth_fractions: Optional[tuple] = None,
    ):
        """Return a one-pixel PNG or its cached depth-aware splat buffers."""
        geometry_token = geometry.cache_token
        view_region = tuple(float(value) for value in region) if region else (
            0.0, float(camera.width), 0.0, float(camera.height)
        )
        clip_depth = (
            tuple(float(value) for value in depth_range)
            if depth_range else None
        )
        clip_fractions = (
            tuple(float(value) for value in depth_fractions)
            if depth_fractions else None
        )
        cache_key = (
            "render-base", self.BACKGROUND_VERSION,
            geometry_token, image_id, max_size, color_mode,
            view_region, clip_frame, clip_depth, clip_fractions
        )
        splat_key = (
            self.BACKGROUND_VERSION,
            geometry_token, image_id, max_size, color_mode,
            view_region, clip_frame, clip_depth, clip_fractions,
        )
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
        self._check_render_request(request_stream, request_id)
        width, height, scale = self.preview_geometry(camera, max_size)

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
            xyz, rgb = geometry.xyz, geometry.rgb
            region_left, region_right, region_top, region_bottom = view_region
            region_scale_x = width / (region_right - region_left)
            region_scale_y = height / (region_bottom - region_top)
            projection_left = max(region_left, 0.0) if clip_frame else region_left
            projection_right = (
                min(region_right, float(camera.width))
                if clip_frame else region_right
            )
            projection_top = max(region_top, 0.0) if clip_frame else region_top
            projection_bottom = (
                min(region_bottom, float(camera.height))
                if clip_frame else region_bottom
            )
            pose_accessor = image.cam_from_world
            pose = pose_accessor() if callable(pose_accessor) else pose_accessor
            matrix = np.asarray(pose.matrix(), dtype=np.float32)
            xyz_camera = xyz @ matrix[:, :3].T + matrix[:, 3]
            self._check_render_request(request_stream, request_id)
            z = xyz_camera[:, 2]
            if clip_fractions:
                # Without a browser-loaded geometry there are no absolute GPU
                # planes to share. Resolve fractions against this geometry's
                # exact positive camera-depth extent instead.
                positive_depth = z[z > 1e-6]
                if len(positive_depth):
                    base_near = float(np.min(positive_depth))
                    base_far = float(np.max(positive_depth))
                    span = max(base_far - base_near, 1e-9)
                    clip_depth = (
                        base_near + span * clip_fractions[0],
                        base_near + span * clip_fractions[1],
                    )
            is_pinhole = camera.model_name in {"PINHOLE", "SIMPLE_PINHOLE"}
            # Exact pre-projection frustum test for the pinhole models. This
            # avoids running camera projection for off-screen positive-depth
            # points (all cameras in the current dataset are PINHOLE).
            if projection_right <= projection_left or projection_bottom <= projection_top:
                visible = np.zeros_like(z, dtype=bool)
            elif is_pinhole:
                if camera.model_name == "PINHOLE":
                    fx, fy, cx, cy = camera.params
                else:
                    fx, cx, cy = camera.params
                    fy = fx
                # COLMAP coordinates are corner-based: pixel (x, y) covers
                # [x, x + 1) by [y, y + 1). Match those output bounds exactly
                # so no second in-frame filtering/copy is needed.
                left = (projection_left - cx) / fx
                right = (projection_right - cx) / fx
                top = (projection_top - cy) / fy
                bottom = (projection_bottom - cy) / fy
                visible = ne.evaluate(
                    "(z > 1e-6) & (x >= left*z) & (x < right*z) "
                    "& (y >= top*z) & (y < bottom*z)",
                    local_dict={
                        "z": z,
                        "x": xyz_camera[:, 0],
                        "y": xyz_camera[:, 1],
                        "left": left,
                        "right": right,
                        "top": top,
                        "bottom": bottom,
                    },
                )
            else:
                visible = z > 1e-6
            if clip_depth:
                visible &= (z >= clip_depth[0]) & (z <= clip_depth[1])
            xyz_camera = xyz_camera[visible]
            colors = rgb[visible]

            canvas = self._canvas(width, height)
            zbuffer = np.full(height * width, np.inf, dtype=np.float32)
            if len(xyz_camera):
                if is_pinhole:
                    depth = xyz_camera[:, 2]
                    u = ne.evaluate(
                        "(f*x/depth + c - offset)*output_scale",
                        local_dict={
                            "f": fx,
                            "x": xyz_camera[:, 0],
                            "depth": depth,
                            "c": cx,
                            "offset": region_left,
                            "output_scale": region_scale_x,
                        },
                    )
                    v = ne.evaluate(
                        "(f*y/depth + c - offset)*output_scale",
                        local_dict={
                            "f": fy,
                            "y": xyz_camera[:, 1],
                            "depth": depth,
                            "c": cy,
                            "offset": region_top,
                            "output_scale": region_scale_y,
                        },
                    )
                    x = np.floor(u).astype(np.int64, copy=False)
                    y = np.floor(v).astype(np.int64, copy=False)
                    # Only floating-point boundary noise can reach the clamp;
                    # the fused frustum test above already enforces bounds.
                    np.clip(x, 0, width - 1, out=x)
                    np.clip(y, 0, height - 1, out=y)
                else:
                    # pycolmap handles arbitrary distorted/fisheye models.
                    uv = np.asarray(
                        camera.img_from_cam(xyz_camera), dtype=np.float32
                    )
                    if clip_frame:
                        in_frame = (
                            (uv[:, 0] >= 0) & (uv[:, 0] < camera.width)
                            & (uv[:, 1] >= 0) & (uv[:, 1] < camera.height)
                        )
                        uv = uv[in_frame]
                        xyz_camera = xyz_camera[in_frame]
                        colors = colors[in_frame]
                    uv[:, 0] = (uv[:, 0] - region_left) * region_scale_x
                    uv[:, 1] = (uv[:, 1] - region_top) * region_scale_y
                    finite = np.isfinite(uv).all(axis=1)
                    uv, xyz_camera, colors = uv[finite], xyz_camera[finite], colors[finite]
                    x = np.floor(uv[:, 0]).astype(np.int64, copy=False)
                    y = np.floor(uv[:, 1]).astype(np.int64, copy=False)
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
                    flat_canvas = canvas.reshape(-1, 4)
                    flat_canvas[pixel, :3] = colors
                    flat_canvas[pixel, 3] = 255

            self._check_render_request(request_stream, request_id)
            if not need_splat_data:
                return self._cache_put(cache_key, self._encode_png(canvas))

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

    def render_png(
        self,
        image_id: int,
        image,
        camera,
        geometry: GeometryData,
        max_size: int = 1600,
        color_mode: str = "rgb",
        radius: int = 1,
        request_stream: str = "default",
        region: Optional[tuple] = None,
        clip_frame: bool = False,
        depth_range: Optional[tuple] = None,
        depth_fractions: Optional[tuple] = None,
    ) -> bytes:
        """Project every point, reusing projection when only size changes."""
        if color_mode not in {"rgb", "depth", "white"}:
            raise ValueError("color_mode must be rgb, depth, or white")
        if not 0 <= radius <= 7:
            raise ValueError("radius must be between 0 and 7")
        if depth_range and (
            len(depth_range) != 2
            or depth_range[0] <= 0
            or depth_range[1] <= depth_range[0]
        ):
            raise ValueError("depth_range requires 0 < near < far")
        if depth_fractions and (
            len(depth_fractions) != 2
            or depth_fractions[0] < 0
            or depth_fractions[1] > 1
            or depth_fractions[1] <= depth_fractions[0]
        ):
            raise ValueError(
                "depth_fractions requires 0 <= near < far <= 1"
            )
        if depth_range and depth_fractions:
            raise ValueError(
                "depth_range and depth_fractions are mutually exclusive"
            )

        geometry_token = geometry.cache_token
        cache_key = (
            "render-sized", self.BACKGROUND_VERSION, geometry_token,
            image_id, max_size, color_mode, radius,
            tuple(float(value) for value in region) if region else None,
            clip_frame,
            tuple(float(value) for value in depth_range) if depth_range else None,
            (
                tuple(float(value) for value in depth_fractions)
                if depth_fractions else None
            ),
        )
        if radius > 0:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        base = self._get_reprojection_base(
            image_id,
            image,
            camera,
            max_size,
            color_mode,
            geometry,
            need_splat_data=radius > 0,
            request_stream=request_stream,
            region=region,
            clip_frame=clip_frame,
            depth_range=depth_range,
            depth_fractions=depth_fractions,
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
        canvas = self._canvas(base_color.shape[1], base_color.shape[0])
        canvas.reshape(-1, 4)[valid] = base_color.reshape(-1, 4)[winner_pixels]
        return self._cache_put(cache_key, self._encode_png(canvas))
