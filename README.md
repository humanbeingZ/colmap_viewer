# COLMAP Viewer

This is a web-based tool for visualizing COLMAP data, including images, feature matches, and epipolar lines.

## Description

The COLMAP Viewer provides an interactive interface to inspect the results of a COLMAP reconstruction. It allows users to select pairs of images and visualize the feature matches between them, including inlier and outlier matches. The viewer is built with a Python FastAPI backend and a vanilla JavaScript frontend.

## Features

*   **Image Visualization:** View images from a COLMAP project.
*   **Feature Matching:** Visualize feature matches between two images.
*   **Inlier/Outlier Filtering:** Filter matches to show only inliers or outliers.
*   **Interactive Controls:** Pan and zoom within the images.
*   **Match Statistics:** View a summary of match statistics, including the number of total, inlier, and outlier matches, and the two-view configuration.
*   **Multiple Data Sources:** Supports loading data from either a COLMAP project folder or a database file.

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

```bash
python main.py -i /path/to/your/images -d /path/to/your/colmap/database.db
```

Then, open your web browser and navigate to `http://localhost:8000`.

## UI Overview

The user interface consists of a control panel on the left and a viewer on the right.

*   **Control Panel:**
    *   **Data Source:** Select the data source (if multiple are available).
    *   **Image Selection:** Select the two images to compare.
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

## API Endpoints

The following API endpoints are available:

*   `GET /`: Serves the main HTML page.
*   `GET /serve_image/{image_path:path}`: Serves an image file.
*   `GET /api/sources`: Returns a list of available data sources.
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
*   [numpy](httpshttps://numpy.org/)
*   [Pillow](https://python-pillow.org/)
*   [jinja2](https://jinja.palletsprojects.com/)
