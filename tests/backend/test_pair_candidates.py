import unittest

from viewer.colmap_service import ColmapService, DataSource


class FakeDatabase:
    def __init__(self, has_matches):
        self.has_matches = has_matches

    def exists_matches(self, image_id1, image_id2):
        return self.has_matches

    def read_matches(self, image_id1, image_id2):
        return [[0, 0]] if self.has_matches else []


class FakeImage:
    points2D = []


class FakeReconstruction:
    images = {1: FakeImage(), 2: FakeImage()}
    points3D = {}


class FakePoseNeighbors:
    def candidates(self, image_id, limit):
        return [2][:limit]


class PairCandidatesTest(unittest.TestCase):
    def service(self, database_has_matches, active_source=DataSource.SFM_MODEL):
        service = ColmapService("")
        service.db = FakeDatabase(database_has_matches)
        service.reconstruction = FakeReconstruction()
        service._pose_neighbor_index = FakePoseNeighbors()
        service.active_source = active_source
        service.get_images = lambda: [{"id": 1}, {"id": 2}]
        return service

    def test_sfm_source_uses_pose_neighbors_when_database_is_empty(self):
        result = self.service(False).get_pair_candidates(1, max_pose_neighbors=5)
        self.assertEqual(result, {"image_ids": [2], "source": "pose_neighbors"})

    def test_sfm_source_ignores_database_matches(self):
        result = self.service(True).get_pair_candidates(1, max_pose_neighbors=5)
        self.assertEqual(result, {"image_ids": [2], "source": "pose_neighbors"})

    def test_database_source_uses_database_matches(self):
        result = self.service(
            True, active_source=DataSource.DATABASE
        ).get_pair_candidates(1, max_pose_neighbors=5)
        self.assertEqual(result, {"image_ids": [2], "source": "matches"})

    def test_database_source_does_not_mix_in_pose_neighbors(self):
        result = self.service(
            False, active_source=DataSource.DATABASE
        ).get_pair_candidates(1, max_pose_neighbors=5)
        self.assertEqual(result, {"image_ids": [], "source": "matches"})


if __name__ == "__main__":
    unittest.main()
