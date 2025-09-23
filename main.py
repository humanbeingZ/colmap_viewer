
import argparse
import os
from typing import List, Dict, Any
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from colmap_service import ColmapService

colmap_service: ColmapService

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the ML model
    global colmap_service
    colmap_service.load()
    yield
    # Clean up the ML models and release the resources

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
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/serve_image/{image_path:path}")
async def serve_image(image_path: str):
    full_path = os.path.join(colmap_service.image_base_path, image_path)
    real_path = os.path.realpath(full_path)

    if not os.path.exists(real_path) or not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="Image not found")

    import mimetypes

    media_type, _ = mimetypes.guess_type(real_path)
    if media_type is None:
        media_type = "application/octet-stream"

    with open(real_path, "rb") as f:
        content = f.read()

    return Response(content=content, media_type=media_type)


@app.get("/api/images", response_model=List[Dict[str, Any]])
async def get_images():
    images = colmap_service.get_images()
    if not images:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded.")
    return images


@app.get("/api/image_data/{image_id}")
async def get_image_data(image_id: int):
    image_data = colmap_service.get_image_data(image_id)
    if image_data is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    return image_data


@app.get("/api/matches_for_image/{image_id}")
async def get_matches_for_image(image_id: int):
    return colmap_service.get_matches_for_image(image_id)


@app.get("/api/matches/{image_id1}/{image_id2}")
async def get_matches(image_id1: int, image_id2: int):
    matches = colmap_service.get_matches(image_id1, image_id2)
    if matches is None:
        raise HTTPException(status_code=500, detail="Error reading matches.")
    return matches


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--colmap_project_path", type=str, required=True)
    parser.add_argument("--image_base_path", type=str, required=True)
    args = parser.parse_args()

    colmap_service = ColmapService(args.colmap_project_path, args.image_base_path)

    uvicorn.run(app, host="0.0.0.0", port=8000)
