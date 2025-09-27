import pycolmap
import os
from typing import List, Dict, Any, Optional
from enum import Enum


class DataSource(Enum):
    SFM_MODEL = "SfM Model"
    DATABASE = "Database"


class ColmapService:
    def __init__(self, image_path: str, project_path: Optional[str] = None, db_path: Optional[str] = None):
        self.image_base_path = image_path
        self.project_path = project_path
        self.db_path = db_path

        self.reconstruction: Optional[pycolmap.Reconstruction] = None
        self.db: Optional[pycolmap.Database] = None

        self.sources: List[DataSource] = []
        self.active_source: Optional[DataSource] = None

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
