"""Pose-derived epipolar geometry for undistorted COLMAP cameras."""

import numpy as np


class PoseNeighborIndex:
    """Vectorized camera-neighbor lookup for reconstructions without tracks."""

    def __init__(self, image_ids, centers, forward_directions):
        self.image_ids = np.asarray(image_ids, dtype=np.int64)
        self.centers = np.asarray(centers, dtype=np.float64)
        self.forward_directions = np.asarray(forward_directions, dtype=np.float64)
        self._indices = {
            int(image_id): index for index, image_id in enumerate(self.image_ids)
        }
        extent = np.linalg.norm(np.ptp(self.centers, axis=0))
        self.minimum_baseline = max(float(extent) * 1e-9, 1e-12)

    @classmethod
    def from_reconstruction(cls, reconstruction):
        image_ids = []
        centers = []
        forward_directions = []
        camera_forward = np.asarray([0.0, 0.0, 1.0])
        for image_id, image in reconstruction.images.items():
            transform = pose_matrix(image)
            rotation, translation = transform[:, :3], transform[:, 3]
            center = -rotation.T @ translation
            forward = rotation.T @ camera_forward
            norm = np.linalg.norm(forward)
            if not np.isfinite(center).all() or not np.isfinite(norm) or norm < 1e-12:
                continue
            image_ids.append(image_id)
            centers.append(center)
            forward_directions.append(forward / norm)
        if not image_ids:
            raise ValueError("The reconstruction has no finite registered camera poses")
        return cls(image_ids, centers, forward_directions)

    def candidates(self, image_id: int, limit: int) -> list[int]:
        index = self._indices.get(int(image_id))
        if index is None or limit <= 0:
            return []
        offsets = self.centers - self.centers[index]
        distances = np.linalg.norm(offsets, axis=1)
        alignment = np.clip(
            self.forward_directions @ self.forward_directions[index], -1.0, 1.0
        )
        # Nearby cameras are useful only when their fields of view are likely
        # related. The fourth-power penalty strongly prefers co-oriented views
        # while still providing a deterministic fallback for unusual rigs.
        scores = distances * np.power(2.0 - alignment, 4)
        scores[distances <= self.minimum_baseline] = np.inf
        scores[index] = np.inf
        order = np.argsort(scores, kind="stable")
        return [
            int(self.image_ids[candidate])
            for candidate in order[:limit]
            if np.isfinite(scores[candidate])
        ]


def calibration_matrix(camera) -> np.ndarray:
    """Return the pixel calibration matrix for a straight-line camera model."""
    if camera.model_name == "PINHOLE":
        fx, fy, cx, cy = np.asarray(camera.params, dtype=np.float64)
    elif camera.model_name == "SIMPLE_PINHOLE":
        focal, cx, cy = np.asarray(camera.params, dtype=np.float64)
        fx = fy = focal
    else:
        raise ValueError(
            "Epipolar lines require PINHOLE or SIMPLE_PINHOLE cameras; "
            f"{camera.model_name} has curved epipolar loci in stored pixels"
        )
    return np.asarray([
        [fx, 0.0, cx],
        [0.0, fy, cy],
        [0.0, 0.0, 1.0],
    ])


def pose_matrix(image) -> np.ndarray:
    pose_accessor = image.cam_from_world
    pose = pose_accessor() if callable(pose_accessor) else pose_accessor
    matrix = np.asarray(pose.matrix(), dtype=np.float64)
    if matrix.shape != (3, 4):
        raise ValueError(f"Expected a 3x4 world-to-camera pose, got {matrix.shape}")
    return matrix


def skew(vector: np.ndarray) -> np.ndarray:
    x, y, z = vector
    return np.asarray([
        [0.0, -z, y],
        [z, 0.0, -x],
        [-y, x, 0.0],
    ])


def fundamental_matrix(image1, camera1, image2, camera2) -> np.ndarray:
    """Compute $F$ such that $x_2^T F x_1 = 0$ from COLMAP poses."""
    transform1 = pose_matrix(image1)
    transform2 = pose_matrix(image2)
    rotation1, translation1 = transform1[:, :3], transform1[:, 3]
    rotation2, translation2 = transform2[:, :3], transform2[:, 3]
    relative_rotation = rotation2 @ rotation1.T
    relative_translation = translation2 - relative_rotation @ translation1
    if np.linalg.norm(relative_translation) < 1e-12:
        raise ValueError("The selected cameras have no usable baseline")

    essential = skew(relative_translation) @ relative_rotation
    calibration1 = calibration_matrix(camera1)
    calibration2 = calibration_matrix(camera2)
    fundamental = (
        np.linalg.inv(calibration2).T
        @ essential
        @ np.linalg.inv(calibration1)
    )
    scale = np.linalg.norm(fundamental)
    if not np.isfinite(scale) or scale < 1e-15:
        raise ValueError("Unable to compute a finite fundamental matrix")
    return fundamental / scale
