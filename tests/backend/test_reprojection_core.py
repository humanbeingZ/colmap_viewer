import unittest

import numpy as np

from viewer.reprojection.core import (
    BoundedLRUCache,
    GeometryCapacityError,
    GeometryData,
    GeometryUploadSuperseded,
    RenderSuperseded,
    SupersessionTracker,
    ViewerGeometryStore,
)


def geometry(name: str, revision: int = 1) -> GeometryData:
    return GeometryData(
        xyz=np.zeros((1, 3), dtype=np.float32),
        rgb=np.zeros((1, 3), dtype=np.uint8),
        name=name,
        kind="point cloud",
        revision=revision,
        cache_token=name,
    )


class BoundedLRUCacheTest(unittest.TestCase):
    def test_recent_access_controls_eviction(self):
        cache = BoundedLRUCache(2)
        cache.put(("a",), 1)
        cache.put(("b",), 2)
        self.assertEqual(cache.get(("a",)), 1)
        cache.put(("c",), 3)
        self.assertIsNone(cache.get(("b",)))
        self.assertEqual(cache.get(("a",)), 1)
        self.assertEqual(cache.get(("c",)), 3)


class SupersessionTrackerTest(unittest.TestCase):
    def test_requests_are_superseded_only_within_their_stream(self):
        tracker = SupersessionTracker(RenderSuperseded, lambda value: value)
        first = tracker.begin("viewer-a")
        other = tracker.begin("viewer-b")
        tracker.check("viewer-a", first)
        tracker.check("viewer-b", other)
        newest = tracker.begin("viewer-a")
        with self.assertRaises(RenderSuperseded):
            tracker.check("viewer-a", first)
        tracker.check("viewer-a", newest)
        tracker.check("viewer-b", other)

    def test_commit_does_not_publish_a_superseded_request(self):
        tracker = SupersessionTracker(RenderSuperseded, lambda value: value)
        old_request = tracker.begin("viewer")
        tracker.begin("viewer")
        published = []

        with self.assertRaises(RenderSuperseded):
            tracker.commit(
                "viewer", old_request, lambda: published.append(True)
            )

        self.assertEqual(published, [])


class ViewerGeometryStoreTest(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.store = ViewerGeometryStore(
            max_uploaded_geometries=2,
            max_colmap_selections=8,
            idle_timeout_seconds=10,
            normalize_stream=lambda value: value,
            clock=lambda: self.now,
        )

    def upload(self, stream: str, name: str, generation: int = 1):
        token = self.store.begin_upload(stream, generation)
        self.store.install(stream, token, geometry(name))
        self.store.cancel_upload(stream, token)

    def test_uploaded_and_reset_geometry_are_scoped_per_viewer(self):
        self.store.set_default(geometry("default"))
        self.upload("viewer-a", "external")
        self.assertEqual(self.store.status("viewer-a", 7)["name"], "external")
        self.assertEqual(self.store.status("viewer-b", 7)["name"], "default")
        self.store.reset_to_colmap("viewer-a")
        status = self.store.status("viewer-a", 7)
        self.assertEqual(status["kind"], "colmap")
        self.assertEqual(status["point_count"], 7)

    def test_capacity_rejects_without_evicting_an_active_viewer(self):
        self.upload("viewer-a", "a")
        self.upload("viewer-b", "b")
        with self.assertRaises(GeometryCapacityError):
            self.store.begin_upload("viewer-c", 1)
        self.assertEqual(self.store.status("viewer-a", 0)["name"], "a")

    def test_preloaded_geometry_selection_is_scoped_per_stream(self):
        self.store.select("viewer:left", geometry("left geometry"))
        self.store.select("viewer:right", geometry("right geometry"))

        self.assertEqual(
            self.store.status("viewer:left", 0)["name"], "left geometry"
        )
        self.assertEqual(
            self.store.status("viewer:right", 0)["name"], "right geometry"
        )

    def test_idle_geometry_is_reclaimed_before_capacity_check(self):
        self.upload("viewer-a", "a")
        self.upload("viewer-b", "b")
        self.now += 11
        token = self.store.begin_upload("viewer-c", 1)
        self.store.install("viewer-c", token, geometry("c"))
        self.assertEqual(self.store.status("viewer-c", 0)["name"], "c")

    def test_only_latest_upload_can_publish(self):
        old_token = self.store.begin_upload("viewer", 1)
        new_token = self.store.begin_upload("viewer", 2)
        self.store.install("viewer", new_token, geometry("new"))
        with self.assertRaises(GeometryUploadSuperseded):
            self.store.install("viewer", old_token, geometry("old"))
        self.assertEqual(self.store.status("viewer", 0)["name"], "new")

    def test_reset_invalidates_an_upload_still_being_parsed(self):
        token = self.store.begin_upload("viewer", 1)
        self.store.reset_to_colmap("viewer")
        with self.assertRaises(GeometryUploadSuperseded):
            self.store.install("viewer", token, geometry("late"))
        self.assertEqual(self.store.status("viewer", 3)["kind"], "colmap")


if __name__ == "__main__":
    unittest.main()
