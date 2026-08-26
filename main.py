import argparse
import os
import tempfile
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.concurrency import run_in_threadpool

from colmap_service import ColmapService
from reprojection_core import (
    GeometryCapacityError,
    GeometryUploadSuperseded,
    InputSuperseded,
    RenderSuperseded,
)

colmap_service: ColmapService

@asynccontextmanager
async def lifespan(app: FastAPI):
    global colmap_service
    colmap_service.load()

    if not colmap_service.get_available_sources():
        raise RuntimeError("Failed to load any COLMAP data. Please check the paths provided.")

    yield
    # Clean up resources if needed

app = FastAPI(lifespan=lifespan)

# Mount static files (CSS, JS)
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
    name="static",
)

# Configure Jinja2Templates for HTML templating
templates = Jinja2Templates(
    directory=os.path.join(os.path.dirname(__file__), "templates")
)


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "default_pose_neighbors": ColmapService.DEFAULT_POSE_NEIGHBORS,
            "max_pose_neighbors": ColmapService.MAX_POSE_NEIGHBORS,
        },
    )


@app.get("/serve_image/{image_path:path}")
async def serve_image(image_path: str):
    image_root = os.path.abspath(colmap_service.image_base_path)
    full_path = os.path.abspath(os.path.join(image_root, image_path))

    # Reject lexical traversal while allowing symlinks located inside the
    # configured image tree to resolve to shared data elsewhere.
    if os.path.commonpath([image_root, full_path]) != image_root:
        raise HTTPException(status_code=400, detail="Image path escapes image root")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Image not found")

    import mimetypes

    media_type, _ = mimetypes.guess_type(full_path)
    if media_type is None:
        media_type = "application/octet-stream"

    with open(full_path, "rb") as f:
        content = f.read()

    return Response(content=content, media_type=media_type)

# --- New API Endpoints ---

@app.get("/api/sources", response_model=List[str])
async def get_sources():
    return colmap_service.get_available_sources()


@app.get("/api/capabilities")
async def get_capabilities(stream: str = "default"):
    available = colmap_service.has_reprojection_data()
    if available:
        colmap_service.start_reprojection_warmup()
    return {
        "reprojection": available,
        "dataset_namespace": colmap_service.cache_namespace,
        "max_reprojection_size": colmap_service.MAX_REPROJECTION_SIZE,
        "geometry": colmap_service.get_geometry_status(stream),
    }


@app.get("/api/reprojection/images", response_model=List[Dict[str, Any]])
async def get_reprojection_images():
    if not colmap_service.has_reprojection_data():
        raise HTTPException(
            status_code=409,
            detail="3D reprojection requires a sparse model with registered camera poses.",
        )
    return colmap_service.get_reprojection_images()


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
):
    try:
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
            image_id, max_size, color, radius, request_stream=stream
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--image_base_path", type=str, required=True)
    parser.add_argument("-c", "--colmap_project_path", type=str, default=None)
    parser.add_argument("-d", "--database_path", type=str, default=None)
    parser.add_argument(
        "-g", "--geometry", type=str, default=None,
        help="PLY point cloud or mesh to use instead of COLMAP points3D",
    )
    parser.add_argument("-p", "--port", type=int, default=8000)
    args = parser.parse_args()

    if not args.colmap_project_path and not args.database_path:
        raise ValueError("You must provide either --colmap_project_path or --database_path")

    colmap_service = ColmapService(
        image_path=args.image_base_path,
        project_path=args.colmap_project_path,
        db_path=args.database_path,
        geometry_path=args.geometry,
    )

    uvicorn.run(app, host="0.0.0.0", port=args.port)
