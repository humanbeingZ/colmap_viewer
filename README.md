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
*   **External PLY Geometry:** Drop a PLY point cloud, triangle mesh, or Gaussian Splatting PLY into the reprojection viewer. Pinhole cameras use direct, depth-tested Three.js rendering; distorted cameras retain the calibrated numerical fallback.

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

The prebuilt browser renderer is checked into `static/vendor`, so Node.js is
not required to run the viewer. To rebuild it while developing, run
`npm install` followed by `npm run build`.

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

One or more external PLY files can also be loaded at startup. They are assumed
to use the same world coordinate system as the COLMAP reconstruction:

```bash
python main.py -i /path/to/images -c /path/to/sparse \
    -g /path/to/points.ply /path/to/mesh.ply /path/to/gaussians.ply
```

An optional mask directory can mirror the image hierarchy. Mask files may use
the image filename or the same stem with a common image extension, such as
`images/cam0/frame.jpg` and `masks/cam0/frame.png`:

```bash
python main.py -i /path/to/images -c /path/to/sparse -m /path/to/masks
```

When masks are configured, the 3D reprojection Comparison controls include a
**Masked input** and **Invert mask** checkboxes. White mask pixels retain the
input image, black mask pixels become black, and intermediate grayscale values
attenuate the image. **Invert mask** is off by default and reverses those mask
values when enabled. Press `m` in the reprojection viewer to toggle masked input.
Press `i` to toggle mask inversion.

```bash
python main.py -i /path/to/your/images -d /path/to/your/colmap/database.db
```

Then, open your web browser and navigate to `http://localhost:8000`.

## Tests

Run the backend and dependency-free browser regression suites:

```bash
python -m unittest discover -s tests/backend -p 'test_*.py'
npm test
```

## Project layout

- `main.py` is the command-line launcher.
- `viewer/` contains the FastAPI application and Python implementation.
- `viewer/geometry/` contains PLY and epipolar geometry utilities.
- `viewer/reprojection/` contains render state and numerical rendering code.
- `static/js/matching/` and `static/js/reprojection/` contain the two viewer modes.
- `static/js/shared/` contains browser state shared between viewer modes.
- `tests/backend/` and `tests/frontend/` mirror the implementation boundaries.

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
        *   **Draw Epipolar Lines:** Move a corresponding epipolar line across both images to inspect pose precision.
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
reprojection image. With `PINHOLE` and `SIMPLE_PINHOLE` cameras, the browser
reads the selected file directly: triangle meshes are rasterized as triangles,
Gaussian PLYs use their opacity, scale, rotation, and available spherical
harmonics, and ordinary PLYs are rendered as points. This path does not copy the
file to the server and therefore has no fixed 1 GiB upload limit. The practical
limit is available browser/GPU memory; parsing temporarily holds the source
buffer and decoded geometry at the same time.

Loaded geometry uses its filename as its source label; duplicate labels receive
a numeric suffix automatically. Use the pencil action in either pane's source
menu to rename any source, including COLMAP points and the camera image. Manual
labels may intentionally be identical because sources retain separate internal
identities. Switching sources with the menu or the `t`/`y` shortcuts updates
both selected labels in the upper corners of their panes. The Comparison
controls show labels continuously by default and can instead hide them or fade
them after two seconds.
The left and right source menus provide rename, cycling-visibility, and info
actions. The info action shows the source label, filename, and available path,
with a separate copy button for each value. Browser-selected files do not
expose their filesystem path, so only their filename is available. Files
loaded through `-g` or the server-local path control show their canonical path
to the authorized loopback viewer.

COLMAP distortion cannot be represented by a standard Three.js perspective
camera. For distorted camera models, the viewer therefore uses its calibrated
server renderer rather than displaying an inaccurate overlay. Every configured
geometry remains independently selectable in that fallback, including separate
left and right selections. The fallback reads `x`, `y`, `z`, RGB or degree-zero
`f_dc` color, and optional faces;
Gaussian scale/rotation/opacity are not used, and mesh faces are sampled into
at most five million rendered points. Because fallback files cross the HTTP
request boundary, its existing 1 GiB upload limit still applies.

Geometry files provided with `--geometry` are loaded in command-line order and
use the same automatic point-cloud, triangle-mesh, or Gaussian rendering path
as dropped files. Browser access to those configured local files is restricted
to loopback clients; remote browser connections retain the numerical fallback.
Very large binary little-endian triangle meshes are memory-mapped by the
server and streamed as compact, locally indexed chunks. The browser represents
those chunks as multiple Three.js geometries, preserving every triangle while
avoiding a multi-gigabyte source `ArrayBuffer` and oversized individual GPU
buffers. This path currently requires fixed-width vertices followed by
triangle faces with 32-bit indices, which is the common binary PLY layout
written by MeshLab and trimesh.

Server-rendered uploaded geometry is scoped
to the browser tab that loaded it; other viewers retain their own selection.
The server retains up to eight active uploaded geometries and rejects further
uploads with an explicit capacity error instead of silently changing an
existing viewer's geometry. A browser tab keeps its viewer identity across
reloads, while duplicated tabs negotiate distinct identities. Each tab sends a
lightweight heartbeat; geometry from a closed or abandoned viewer is released
after ten minutes without activity.
Use **Use COLMAP points3D** to restore the reconstruction's original sparse
points in the current viewer.

To inspect a renderer handoff, add `gpu_transition_debug_ms=<milliseconds>` to
the viewer URL. The viewer pauses before and after exposing the incoming frame
and labels both stages; omit the parameter during normal use.

## API Endpoints

The following API endpoints are available:

*   `GET /`: Serves the main HTML page.
*   `GET /serve_image/{image_path:path}`: Serves an image file.
*   `GET /api/sources`: Returns a list of available data sources.
*   `GET /api/capabilities`: Reports whether 3D reprojection is available.
*   `GET /api/reprojection/images`: Lists registered reconstruction images.
*   `GET /api/reprojection/configured-geometry`: Streams a token-selected `-g` file to an authorized loopback viewer.
*   `POST /api/reprojection/geometry`: Loads an uploaded PLY point cloud or mesh.
*   `DELETE /api/reprojection/geometry`: Restores COLMAP `points3D`.
*   `POST /api/reprojection/stream/heartbeat`: Keeps a viewer's geometry active.
*   `DELETE /api/reprojection/stream`: Explicitly releases a viewer's geometry.
*   `GET /api/reprojection/{image_id}/input`: Returns normalized input pixels for comparison; `masked=true` applies a configured image mask and `invert_mask=true` reverses it.
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
*   [Three.js](https://threejs.org/) (prebuilt browser bundle)
