from contextlib import asynccontextmanager
import hashlib
import io
import ipaddress
import os
from pathlib import Path
import tempfile
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.concurrency import run_in_threadpool
from PIL import Image, ImageOps

from .colmap_service import ColmapService
from .reprojection.core import (
    GeometryCapacityError,
    GeometryUploadSuperseded,
    InputSuperseded,
    RenderSuperseded,
)

colmap_service: ColmapService
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _static_asset_version(static_root: Path) -> str:
    """Return a deterministic cache key for every served static asset."""
    digest = hashlib.sha256()
    assets = (path for path in static_root.rglob("*") if path.is_file())
    for path in sorted(assets):
        relative_path = path.relative_to(static_root).as_posix()
        digest.update(f"{relative_path}\0{path.stat().st_size}\0".encode("utf-8"))
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()[:12]


STATIC_ASSET_VERSION = _static_asset_version(PROJECT_ROOT / "static")


def configure_service(service: ColmapService) -> None:
    """Install the service instance used by the application routes."""
    global colmap_service
    colmap_service = service
    # Geometry transport preparation is independent of COLMAP loading, so let
    # it overlap server startup from the moment the CLI service is installed.
    colmap_service.start_configured_mesh_warmup()


@asynccontextmanager
async def lifespan(app: FastAPI):
    colmap_service.load()

    if not colmap_service.get_available_sources():
        raise RuntimeError("Failed to load any COLMAP data. Please check the paths provided.")

    yield


app = FastAPI(lifespan=lifespan)

# Mount static files (CSS, JS)
app.mount(
    "/static",
    StaticFiles(directory=str(PROJECT_ROOT / "static")),
    name="static",
)

# Configure Jinja2Templates for HTML templating
templates = Jinja2Templates(
    directory=str(PROJECT_ROOT / "templates")
)


def _is_loopback_request(request: Request) -> bool:
    if request.client is None:
        return False
    try:
        return ipaddress.ip_address(request.client.host).is_loopback
    except ValueError:
        return False


def _accepts_content_encoding(header: str, encoding: str) -> bool:
    """Return whether an Accept-Encoding value permits an exact encoding."""
    requested_quality = None
    wildcard_quality = None
    for item in header.split(","):
        fields = [field.strip() for field in item.split(";")]
        coding = fields[0].lower()
        quality = 1.0
        for parameter in fields[1:]:
            name, separator, value = parameter.partition("=")
            if separator and name.strip().lower() == "q":
                try:
                    quality = float(value.strip())
                except ValueError:
                    quality = 0.0
                if not 0.0 <= quality <= 1.0:
                    quality = 0.0
        if coding == encoding.lower():
            requested_quality = quality
        elif coding == "*":
            wildcard_quality = quality
    quality = (
        requested_quality
        if requested_quality is not None
        else wildcard_quality
    )
    return quality is not None and quality > 0.0


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "default_pose_neighbors": ColmapService.DEFAULT_POSE_NEIGHBORS,
            "max_pose_neighbors": ColmapService.MAX_POSE_NEIGHBORS,
            "static_asset_version": STATIC_ASSET_VERSION,
        },
    )


def _matching_image_preview(path: str, max_size: int) -> bytes:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        image.thumbnail(
            (max_size, max_size), Image.Resampling.BILINEAR
        )
        if image.mode != "RGB":
            image = image.convert("RGB")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=82)
        return output.getvalue()


@app.get("/serve_image/{image_path:path}")
async def serve_image(image_path: str, max_size: Optional[int] = None):
    image_root = os.path.abspath(colmap_service.image_base_path)
    full_path = os.path.abspath(os.path.join(image_root, image_path))

    # Reject lexical traversal while allowing symlinks located inside the
    # configured image tree to resolve to shared data elsewhere.
    if os.path.commonpath([image_root, full_path]) != image_root:
        raise HTTPException(status_code=400, detail="Image path escapes image root")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Image not found")

    if max_size is not None:
        if max_size < 64 or max_size > 2048:
            raise HTTPException(
                status_code=400,
                detail="Image preview size must be between 64 and 2048 pixels",
            )
        try:
            content = await run_in_threadpool(
                _matching_image_preview, full_path, max_size
            )
        except (OSError, ValueError) as exc:
            raise HTTPException(
                status_code=422, detail="Unable to create image preview"
            ) from exc
        return Response(
            content=content,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )

    import mimetypes
    media_type, _ = mimetypes.guess_type(full_path)
    if media_type is None:
        media_type = "application/octet-stream"

    return FileResponse(
        full_path,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )

# --- New API Endpoints ---

@app.get("/api/sources", response_model=List[str])
async def get_sources():
    return colmap_service.get_available_sources()


def _configured_geometry_descriptor() -> Optional[Dict[str, Any]]:
    configured_geometry = colmap_service.get_configured_geometry_file()
    if not configured_geometry:
        return None
    token = configured_geometry.pop("token")
    revision = configured_geometry["revision"]
    configured_geometry["url"] = (
        "/api/reprojection/configured-geometry"
        f"?token={token}&version={revision}"
    )
    configured_geometry["activate_url"] = (
        f"/api/reprojection/configured-geometry/activate?token={token}"
    )
    mesh_stream = configured_geometry.get("mesh_stream")
    if mesh_stream:
        mesh_stream["chunk_url"] = (
            "/api/reprojection/configured-mesh-chunks/"
            f"{{chunk_index}}?token={token}&version={revision}"
        )
    colmap_service.start_configured_mesh_warmup()
    return configured_geometry


@app.get("/api/capabilities")
async def get_capabilities(request: Request, stream: str = "default"):
    available = colmap_service.has_reprojection_data()
    if available:
        colmap_service.start_reprojection_warmup()
    configured_geometry = None
    if _is_loopback_request(request):
        configured_geometry = await run_in_threadpool(
            _configured_geometry_descriptor
        )
    return {
        "reprojection": available,
        "dataset_namespace": colmap_service.cache_namespace,
        "max_reprojection_size": colmap_service.MAX_REPROJECTION_SIZE,
        "max_input_size": colmap_service.MAX_INPUT_SIZE,
        "geometry": colmap_service.get_geometry_status(stream),
        "configured_geometry": configured_geometry,
    }


@app.post("/api/reprojection/local-geometry")
async def set_local_reprojection_geometry(request: Request):
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Local access only")
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc
    path = body.get("path") if isinstance(body, dict) else None
    if not isinstance(path, str) or not path.strip():
        raise HTTPException(status_code=400, detail="A local PLY path is required")
    try:
        await run_in_threadpool(
            colmap_service.set_configured_geometry_file, path.strip()
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await run_in_threadpool(_configured_geometry_descriptor)


@app.post("/api/reprojection/configured-geometry/activate")
async def activate_configured_reprojection_geometry(
    request: Request, token: str, stream: str = "default"
):
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Local access only")
    try:
        return await run_in_threadpool(
            colmap_service.activate_configured_geometry, token, stream
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/reprojection/images", response_model=List[Dict[str, Any]])
async def get_reprojection_images():
    if not colmap_service.has_reprojection_data():
        raise HTTPException(
            status_code=409,
            detail="3D reprojection requires a sparse model with registered camera poses.",
        )
    return colmap_service.get_reprojection_images()


@app.get("/api/reprojection/colmap-points.ply")
def get_reprojection_colmap_points():
    if not colmap_service.has_reprojection_data():
        raise HTTPException(
            status_code=409,
            detail="A sparse reconstruction is required for COLMAP points.",
        )
    return StreamingResponse(
        colmap_service.iter_colmap_points_ply(),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/reprojection/configured-geometry")
async def get_configured_reprojection_geometry(
    request: Request, token: str, version: str
):
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Local access only")
    geometry_path = colmap_service.resolve_configured_geometry_file(
        token, version
    )
    if geometry_path is None:
        raise HTTPException(status_code=404, detail="Configured geometry not found")
    return FileResponse(
        geometry_path,
        media_type="application/octet-stream",
        filename=os.path.basename(geometry_path),
        headers={"Cache-Control": "private, max-age=3600, immutable"},
    )


@app.get("/api/reprojection/configured-mesh-chunks/{chunk_index}")
def get_configured_mesh_chunk(
    request: Request, chunk_index: int, token: str, version: str
):
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Local access only")
    mesh_stream = colmap_service.get_configured_mesh_stream(token, version)
    if mesh_stream is None:
        raise HTTPException(status_code=404, detail="Streamable mesh not found")
    accepts_gzip = _accepts_content_encoding(
        request.headers.get("accept-encoding", ""), "gzip"
    )
    try:
        result = (
            mesh_stream.prepare_gzip_chunk(chunk_index)
            if accepts_gzip
            else mesh_stream.encode_chunk(chunk_index)
        )
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    headers = {
        "Cache-Control": "private, max-age=3600, immutable",
        "Vary": "Accept-Encoding",
    }
    if accepts_gzip:
        headers["Content-Encoding"] = "gzip"
        return FileResponse(
            result,
            media_type="application/octet-stream",
            headers=headers,
        )
    return Response(
        content=result,
        media_type="application/octet-stream",
        headers=headers,
    )


@app.post("/api/reprojection/geometry")
async def upload_reprojection_geometry(
    request: Request,
    filename: str,
    stream: str = "default",
    generation: Optional[int] = None,
):
    if not filename.lower().endswith(".ply"):
        raise HTTPException(status_code=400, detail="Only .ply geometry is supported")
    try:
        upload_token = colmap_service.begin_external_geometry_upload(
            stream, generation
        )
    except GeometryCapacityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except GeometryUploadSuperseded as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    upload_path = None
    total = 0
    max_upload_bytes = 1024 * 1024 * 1024
    try:
        with tempfile.NamedTemporaryFile(suffix=".ply", delete=False) as upload:
            upload_path = upload.name
            async for chunk in request.stream():
                total += len(chunk)
                if total > max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail="PLY upload exceeds the 1 GiB limit",
                    )
                upload.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Uploaded PLY is empty")
        try:
            status = await run_in_threadpool(
                colmap_service.load_external_geometry,
                upload_path,
                os.path.basename(filename),
                stream,
                upload_token=upload_token,
            )
        except GeometryCapacityError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except GeometryUploadSuperseded as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return status
    finally:
        colmap_service.cancel_external_geometry_upload(stream, upload_token)
        if upload_path and os.path.exists(upload_path):
            os.unlink(upload_path)


@app.delete("/api/reprojection/geometry")
async def reset_reprojection_geometry(stream: str = "default"):
    try:
        return await run_in_threadpool(
            colmap_service.reset_external_geometry, stream
        )
    except GeometryCapacityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/reprojection/stream/heartbeat")
async def heartbeat_reprojection_stream(stream: str = "default"):
    return colmap_service.get_geometry_status(stream)


@app.post("/api/reprojection/cancel-render", status_code=204)
async def cancel_reprojection_render(stream: str = "default"):
    colmap_service.supersede_reprojection_render(stream)
    return Response(status_code=204)


@app.delete("/api/reprojection/stream", status_code=204)
async def release_reprojection_stream(stream: str = "default"):
    colmap_service.release_geometry_stream(stream)
    return Response(status_code=204)


@app.get("/api/reprojection/{image_id}/input")
def get_reprojection_input(
    image_id: int,
    max_size: int = 1600,
    stream: str = "default",
):
    try:
        image = colmap_service.get_reprojection_input_image(
            image_id, max_size, request_stream=stream
        )
    except InputSuperseded:
        return Response(status_code=204)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Image not found: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=image,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/reprojection/{image_id}/render")
def get_reprojection_render(
    image_id: int,
    max_size: int = 1600,
    color: str = "rgb",
    radius: int = 1,
    stream: str = "default",
    geometry: Optional[str] = None,
    left: Optional[float] = None,
    right: Optional[float] = None,
    top: Optional[float] = None,
    bottom: Optional[float] = None,
    near_clip: Optional[float] = None,
    far_clip: Optional[float] = None,
    near_clip_fraction: Optional[float] = None,
    far_clip_fraction: Optional[float] = None,
    clip_frame: bool = False,
):
    try:
        region_values = (left, right, top, bottom)
        if any(value is not None for value in region_values):
            if any(value is None for value in region_values):
                raise ValueError("left, right, top, and bottom must be provided together")
            if right <= left or bottom <= top:
                raise ValueError("render region must have positive width and height")
            region = (left, right, top, bottom)
        else:
            region = None
        if (near_clip is None) != (far_clip is None):
            raise ValueError("near_clip and far_clip must be provided together")
        if near_clip is not None:
            if near_clip <= 0 or far_clip <= near_clip:
                raise ValueError(
                    "Clipping planes require 0 < near_clip < far_clip"
                )
            depth_range = (near_clip, far_clip)
        else:
            depth_range = None
        if (near_clip_fraction is None) != (far_clip_fraction is None):
            raise ValueError(
                "near_clip_fraction and far_clip_fraction "
                "must be provided together"
            )
        if near_clip_fraction is not None:
            if (
                near_clip_fraction < 0
                or far_clip_fraction > 1
                or far_clip_fraction <= near_clip_fraction
            ):
                raise ValueError(
                    "Clipping fractions require 0 <= near < far <= 1"
                )
            if depth_range is not None:
                raise ValueError(
                    "Use clipping planes or clipping fractions, not both"
                )
            depth_fractions = (near_clip_fraction, far_clip_fraction)
        else:
            depth_fractions = None
        current_geometry = colmap_service.get_geometry_status(stream)
        if geometry and geometry != current_geometry["cache_token"]:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "The viewer geometry selection has changed",
                    "geometry": current_geometry,
                },
            )
        png = colmap_service.get_reprojection_render_png(
            image_id, max_size, color, radius,
            request_stream=stream, region=region, clip_frame=clip_frame,
            depth_range=depth_range, depth_fractions=depth_fractions,
        )
    except RenderSuperseded:
        # The browser has already moved to a newer camera. Returning no content
        # avoids reporting a stale render as an application error.
        return Response(status_code=204)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )

@app.post("/api/set_source/{source_name}")
async def set_source(source_name: str):
    success = colmap_service.set_active_source(source_name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Data source '{source_name}' not available.")
    return {"message": f"Active data source set to {source_name}"}

# --- Existing API Endpoints (now source-aware) ---

@app.get("/api/images", response_model=List[Dict[str, Any]])
async def get_images():
    images = colmap_service.get_images()
    if not images:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded or source is empty.")
    return images


@app.get("/api/image_data/{image_id}")
async def get_image_data(image_id: int):
    image_data = colmap_service.get_image_data(image_id)
    if image_data is None:
        raise HTTPException(status_code=404, detail="Image not found in active source.")
    return image_data


@app.get("/api/matches_for_image/{image_id}")
async def get_matches_for_image(
    image_id: int,
    response: Response,
    max_neighbors: int = ColmapService.DEFAULT_POSE_NEIGHBORS,
):
    candidates = colmap_service.get_pair_candidates(image_id, max_neighbors)
    response.headers["X-Pair-Candidate-Source"] = candidates["source"]
    return candidates["image_ids"]


@app.get("/api/matches/{image_id1}/{image_id2}")
async def get_matches(image_id1: int, image_id2: int, match_type: Optional[str] = None):
    matches = colmap_service.get_matches(image_id1, image_id2, match_type)
    if matches is None:
        # This can happen if there are no matches, which is not an error.
        return []
    return matches


@app.get("/api/epipolar/{image_id1}/{image_id2}")
async def get_epipolar_geometry(image_id1: int, image_id2: int):
    try:
        return colmap_service.get_epipolar_geometry(image_id1, image_id2)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Image not found: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/match_summary/{image_id1}/{image_id2}")
async def get_match_summary(image_id1: int, image_id2: int):
    return colmap_service.get_match_summary(image_id1, image_id2)
