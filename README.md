# COLMAP Viewer

This is a web-based tool for visualizing COLMAP data, including images,
feature matches, and independent 3D point reprojections.

## Description

The COLMAP Viewer provides an interactive interface to inspect the results of a COLMAP reconstruction. It allows users to select pairs of images and visualize the feature matches between them, including inlier and outlier matches. The viewer is built with a Python FastAPI backend and a vanilla JavaScript frontend.

## Features

*   **Image Visualization:** View images from a COLMAP project.
*   **Feature Matching:** Visualize feature matches between two images.
*   **Inlier/Outlier Filtering:** Filter matches to show only inliers or outliers.
*   **Interactive Controls:** Pan and zoom within the images.
*   **Keyboard Navigation:** Use arrow keys (Up/Down/Left/Right) to quickly cycle through the second image in a pair.
*   **Match Statistics:** View a summary of match statistics, including the number of total, inlier, and outlier matches, and the two-view configuration.
*   **Multiple Data Sources:** Supports loading data from either a COLMAP project folder or a database file.
*   **Geometry-only Reprojection:** Render every point in `points3D` through a registered camera without using feature observations or tracks.
*   **Reprojection Comparison:** Compare the rendered point cloud and stored image pixels using a draggable split or side-by-side layout. Use the mouse wheel to zoom both comparison layers together, left-drag to pan, drag near the split line to move it, or use `Ctrl` plus the mouse wheel to change rendered point size.
*   **External PLY Geometry:** Drop a PLY point cloud or mesh into the reprojection viewer and project it with the registered COLMAP cameras.

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/humanbeingZ/colmap_viewer.git
    cd colmap_viewer
    ```

2.  Install the required Python packages:
    ```bash
    pip install -r requirements.txt
    ```

## Usage

Run the FastAPI server with the following command, providing the path to your COLMAP project and images:

```bash
python main.py --image_base_path /path/to/your/images --colmap_project_path /path/to/your/colmap/project
```

Alternatively, you can provide a path to a COLMAP database file:

```bash
python main.py --image_base_path /path/to/your/images --database_path /path/to/your/colmap/database.db
```

You can also use shorter aliases for the arguments:

```bash
python main.py -i /path/to/your/images -c /path/to/your/colmap/project
```

An external PLY can also be selected at startup. It is assumed to use the same
world coordinate system as the COLMAP reconstruction:

```bash
python main.py -i /path/to/images -c /path/to/sparse -g /path/to/geometry.ply
```

```bash
python main.py -i /path/to/your/images -d /path/to/your/colmap/database.db
```

Then, open your web browser and navigate to `http://localhost:8000`.

## Tests

Run the backend and dependency-free browser regression suites:

```bash
python -m unittest discover -s tests
node tests/viewer_stream_test.js
node tests/reprojection_request_test.js
node tests/reprojection_split_test.js
node tests/reprojection_point_size_test.js
node tests/reprojection_interaction_test.js
node tests/epipolar_test.js
```

## UI Overview

The user interface consists of a control panel on the left and a viewer on the right.

*   **Control Panel:**
    *   **Viewer Mode:** Switch between feature-match inspection and 3D reprojection.
    *   **Data Source:** Select the data source (if multiple are available).
    *   **Image Selection:** Select the two images to compare. You can also use the arrow keys (Up/Down/Left/Right) to cycle through the second image list.
        Reconstructions without point tracks use nearby, similarly oriented camera poses as image-pair candidates. The viewer labels these generated pairs and lets you configure their maximum count.
    *   **Display Options:**
        *   **Show Markers:** Toggle the visibility of feature markers.
        *   **Show only matched markers:** Show only the markers that have a match in the other image.
        *   **Match Type:** Filter matches by inlier or outlier.
    *   **Action Buttons:**
        *   **Draw Matches:** Toggle the visibility of match lines.
        *   **Draw Epipolar Lines:** (Not yet implemented)
        *   **Reset View:** Reset the zoom and pan of the images.
    *   **Match Summary:** Displays statistics about the matches between the two selected images.

*   **Viewer:**
    *   Displays the two selected images side-by-side.
    *   Overlays feature markers and match lines on the images.
    *   In 3D reprojection mode, displays a draggable render/input split or a side-by-side comparison. Arrow keys select the previous or next registered image.

## 3D Reprojection Mode

Start the viewer with `--colmap_project_path` pointing to a sparse model that
contains `cameras`, `images`, and `points3D` files. Select **3D reprojection**
from the **Viewer Mode** menu. The point render uses only:

* camera intrinsics and distortion model;
* registered world-to-camera pose;
* 3D point coordinates and colors; and
* source image pixels.

It does not use `POINTS2D`, point tracks, extracted features, matches, or a
COLMAP database. The input image is decoded without applying EXIF orientation,
and the orientation menu can be used to test horizontal/vertical flips and a
180-degree rotation.

Drop a `.ply` file onto the geometry drop area or directly onto the
reprojection image. The loader reads only `x`, `y`, `z`, optional
`red`, `green`, `blue`, and optional face vertex indices; other PLY properties
and elements are ignored. Gaussian Splatting PLYs may provide `f_dc_0`,
`f_dc_1`, and `f_dc_2` instead of RGB; their degree-zero spherical-harmonic
coefficients are converted to display RGB, while opacity, scale, rotation, and
higher-order SH properties are ignored. Point-cloud vertices are rendered directly. Mesh
faces are sampled deterministically over their surfaces, up to five million
rendered points. Meshes too large for bounded face expansion fall back to five
million vertices selected from distributed blocks. Uploaded geometry is scoped
to the browser tab that loaded it; other viewers retain their own selection.
The server retains up to eight active uploaded geometries and rejects further
uploads with an explicit capacity error instead of silently changing an
existing viewer's geometry. A browser tab keeps its viewer identity across
reloads, while duplicated tabs negotiate distinct identities. Each tab sends a
lightweight heartbeat; geometry from a closed or abandoned viewer is released
after ten minutes without activity.
Use **Use COLMAP points3D** to restore the reconstruction's original sparse
points in the current viewer.

## API Endpoints

The following API endpoints are available:

*   `GET /`: Serves the main HTML page.
*   `GET /serve_image/{image_path:path}`: Serves an image file.
*   `GET /api/sources`: Returns a list of available data sources.
*   `GET /api/capabilities`: Reports whether 3D reprojection is available.
*   `GET /api/reprojection/images`: Lists registered reconstruction images.
*   `POST /api/reprojection/geometry`: Loads an uploaded PLY point cloud or mesh.
*   `DELETE /api/reprojection/geometry`: Restores COLMAP `points3D`.
*   `POST /api/reprojection/stream/heartbeat`: Keeps a viewer's geometry active.
*   `DELETE /api/reprojection/stream`: Explicitly releases a viewer's geometry.
*   `GET /api/reprojection/{image_id}/input`: Returns normalized input pixels for comparison.
*   `GET /api/reprojection/{image_id}/render`: Returns a z-buffered geometric point rendering.
*   `POST /api/set_source/{source_name}`: Sets the active data source.
*   `GET /api/images`: Returns a list of all images.
*   `GET /api/image_data/{image_id}`: Returns the data for a single image, including feature points.
*   `GET /api/matches_for_image/{image_id}`: Returns a list of image IDs that have matches with the given image.
*   `GET /api/matches/{image_id1}/{image_id2}`: Returns the matches between two images.
*   `GET /api/match_summary/{image_id1}/{image_id2}`: Returns a summary of the matches between two images.

## Dependencies

*   [fastapi](https://fastapi.tiangolo.com/)
*   [uvicorn](https://www.uvicorn.org/)
*   [pycolmap](https://github.com/colmap/pycolmap)
*   [numpy](https://numpy.org/)
*   [Pillow](https://python-pillow.org/)
*   [plyfile](https://github.com/dranjan/python-plyfile)
*   [jinja2](https://jinja.palletsprojects.com/)
