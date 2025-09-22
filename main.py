from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import pycolmap
import numpy as np
import os
import mimetypes
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class Point2D(BaseModel):
    x: float
    y: float
    point3D_id: Optional[int]

class ImageData(BaseModel):
    id: int
    name: str
    width: int
    height: int
    path: str
    points2D: List[Point2D]
    camera_params: List[float]

app = FastAPI()

colmap_project_path = "/home/zhaojing/Projects/zj/room1_0920_hloc" # This should be configurable

# Mount static files (CSS, JS)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

@app.get("/serve_image/{image_path:path}")
async def serve_image(image_path: str):
    full_path = os.path.join(image_base_path, image_path)
    print(f"Attempting to serve image: full_path={full_path}")
    
    # Resolve symlinks and get the real path
    real_path = os.path.realpath(full_path)
    print(f"Resolved real path: real_path={real_path}")
    print(real_path)

    if not os.path.exists(real_path) or not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="Image not found")

    # Determine media type
    import mimetypes
    media_type, _ = mimetypes.guess_type(real_path)
    if media_type is None:
        media_type = "application/octet-stream" # Default if type cannot be guessed

    with open(real_path, "rb") as f:
        content = f.read()
    
    return Response(content=content, media_type=media_type)

# Configure Jinja2Templates for HTML templating
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))

# Global variable to store COLMAP reconstruction data
reconstruction_data = None
image_base_path = "/home/zhaojing/Projects/zj/room1_0920_hloc/images/" # <<< USER: PLEASE UPDATE THIS PATH TO THE DIRECTORY CONTAINING YOUR IMAGE FOLDERS (e.g., 'photo_0', 'video')


@app.on_event("startup")
async def load_colmap_data():
    global reconstruction_data
    try:
        # Load reconstruction
        reconstruction_data = pycolmap.Reconstruction(colmap_project_path)
        print(f"Loaded COLMAP reconstruction with {len(reconstruction_data.images)} images and {len(reconstruction_data.points3D)} 3D points.")
    except Exception as e:
        print(f"Error loading COLMAP data: {e}")
        reconstruction_data = None # Ensure it's None if loading fails

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/images", response_model=List[Dict[str, Any]])
async def get_images():
    if reconstruction_data is None:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded.")
    
    images_list = []
    for image_id, image in reconstruction_data.images.items():
        images_list.append({
            "id": image_id,
            "name": image.name,
            "width": reconstruction_data.cameras[image.camera_id].width,
            "height": reconstruction_data.cameras[image.camera_id].height,
            "path": os.path.join(image_base_path, image.name)
        })
    return images_list

@app.get("/api/image_data/{image_id}", response_model=ImageData)
async def get_image_data(image_id: int):
    if reconstruction_data is None:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded.")
    
    if image_id not in reconstruction_data.images:
        raise HTTPException(status_code=404, detail="Image not found.")
    
    image = reconstruction_data.images[image_id]
    camera = reconstruction_data.cameras[image.camera_id]

    # Get 2D keypoints for the image
    points2D_list = []
    for p in image.points2D:
        points2D_list.append(Point2D(x=p.x(), y=p.y(), point3D_id=p.point3D_id))

    return ImageData(
        id=image_id,
        name=image.name,
        width=camera.width,
        height=camera.height,
        path=os.path.join(image_base_path, image.name),
        points2D=points2D_list,
        camera_params=[float(p) for p in camera.params]
    )


@app.get("/api/matches_for_image/{image_id}")
async def get_matches_for_image(image_id: int):
    if reconstruction_data is None:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded.")

    db_path = os.path.join(colmap_project_path, "database.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=500, detail="Database file not found.")

    try:
        db = pycolmap.Database(db_path)
        matched_image_ids = []
        for other_image_id in reconstruction_data.images:
            if image_id != other_image_id and db.exists_matches(image_id, other_image_id):
                matched_image_ids.append(other_image_id)
        db.close()
        return matched_image_ids
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading matches: {e}")


@app.get("/api/matches/{image_id1}/{image_id2}")
async def get_matches(image_id1: int, image_id2: int):
    if reconstruction_data is None:
        raise HTTPException(status_code=500, detail="COLMAP data not loaded.")

    db_path = os.path.join(colmap_project_path, "database.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=500, detail="Database file not found.")

    try:
        db = pycolmap.Database(db_path)
        matches = db.read_matches(image_id1, image_id2)
        db.close()
        return matches.tolist()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading matches: {e}")

# TODO: Add endpoints for epipolar lines
# This will require reading the database.db file using pycolmap.Database
# and then computing epipolar lines based on camera poses.

