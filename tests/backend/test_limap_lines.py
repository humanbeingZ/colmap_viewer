import unittest

from viewer.colmap_service import ColmapService, DataSource


class FakeLine2D:
    def __init__(self, endpoints, line3d_id=None):
        self._endpoints = endpoints
        self.line3D_id = line3d_id

    def as_array(self):
        return self._endpoints

    def has_line3D(self):
        return self.line3D_id is not None


class FakeStructure2D:
    def __init__(self, lines):
        self.lines = lines


class FakeTrackElement:
    def __init__(self, image_id, point2d_idx):
        self.image_id = image_id
        self.point2D_idx = point2d_idx


class FakeLine3D:
    def __init__(self, observations):
        self.track = type(
            "Track", (), {
                "elements": [FakeTrackElement(*item) for item in observations]
            }
        )()


class FakeStructureReconstruction:
    def __init__(self):
        self.structures2d = {
            1: FakeStructure2D([
                FakeLine2D([[0, 1], [2, 3]], 10),
                FakeLine2D([[4, 5], [6, 7]], 99),
                FakeLine2D([[16, 17], [18, 19]], 10),
            ]),
            2: FakeStructure2D([
                FakeLine2D([[8, 9], [10, 11]], 10),
                FakeLine2D([[12, 13], [14, 15]], 20),
                FakeLine2D([[20, 21], [22, 23]], 10),
            ]),
        }
        self.lines3D = {
            10: FakeLine3D([(1, 0), (1, 2), (2, 0), (2, 2)]),
            20: FakeLine3D([(2, 1), (3, 0)]),
        }

    def structure2d(self, image_id):
        return self.structures2d[image_id]

    def exists_structure2d(self, image_id):
        return image_id in self.structures2d


class FakeImage:
    points2D = []


class FakeReconstruction:
    images = {1: FakeImage(), 2: FakeImage(), 3: FakeImage()}
    points3D = {}


class LimapLinesTest(unittest.TestCase):
    def setUp(self):
        self.service = ColmapService("")
        self.service.active_source = DataSource.SFM_MODEL
        self.service.reconstruction = FakeReconstruction()
        self.service.structure_reconstruction = FakeStructureReconstruction()

    def test_serializes_image_lines(self):
        self.assertEqual(
            self.service._get_lines2d_from_recon(1),
            [
                {"start": [0.0, 1.0], "end": [2.0, 3.0], "line3D_id": 10},
                {"start": [4.0, 5.0], "end": [6.0, 7.0], "line3D_id": None},
                {"start": [16.0, 17.0], "end": [18.0, 19.0], "line3D_id": 10},
            ],
        )

    def test_matches_lines_by_shared_3d_id(self):
        self.assertEqual(
            self.service.get_line_matches(1, 2),
            [[0, 0], [0, 2], [2, 0], [2, 2]],
        )

    def test_line_tracks_contribute_pair_candidates(self):
        self.assertEqual(self.service._get_track_neighbors_from_recon(1), [2])

    def test_database_source_has_no_line_matches(self):
        self.service.active_source = DataSource.DATABASE
        self.assertEqual(self.service.get_line_matches(1, 2), [])

    def test_line_data_capability_requires_active_limap_lines(self):
        self.assertTrue(self.service.has_line_data())
        self.service.active_source = DataSource.DATABASE
        self.assertFalse(self.service.has_line_data())

    def test_line_data_capability_is_false_without_limap(self):
        self.service.structure_reconstruction = None
        self.assertFalse(self.service.has_line_data())

    def test_line_data_capability_is_false_when_structures_are_empty(self):
        self.service.structure_reconstruction = FakeStructureReconstruction()
        self.service.structure_reconstruction.structures2d = {}
        self.assertFalse(self.service.has_line_data())


if __name__ == "__main__":
    unittest.main()
