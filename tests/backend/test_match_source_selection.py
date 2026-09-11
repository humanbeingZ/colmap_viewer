import unittest
from unittest.mock import Mock

from viewer.colmap_service import ColmapService, DataSource


class ArrayLike(list):
    def tolist(self):
        return list(self)


class MatchSourceSelectionTest(unittest.TestCase):
    def setUp(self):
        self.service = ColmapService("")
        self.service.db = Mock()
        self.service.db.read_matches.return_value = ArrayLike([[7, 8]])
        self.service.db.read_two_view_geometry.return_value = None
        self.service.reconstruction = Mock()
        self.service._get_matches_from_recon = Mock(return_value=[[1, 2]])

    def test_sfm_source_uses_reconstruction_even_when_database_is_loaded(self):
        self.service.active_source = DataSource.SFM_MODEL

        self.assertEqual(self.service.get_matches(1, 2, "inlier"), [[1, 2]])
        self.assertEqual(self.service.get_matches(1, 2, "outlier"), [])
        self.service.db.read_matches.assert_not_called()

    def test_database_source_uses_database_even_when_reconstruction_is_loaded(self):
        self.service.active_source = DataSource.DATABASE

        self.assertEqual(self.service.get_matches(1, 2), [[7, 8]])
        self.service._get_matches_from_recon.assert_not_called()


if __name__ == "__main__":
    unittest.main()
