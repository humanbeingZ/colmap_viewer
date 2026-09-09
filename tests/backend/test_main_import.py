import asyncio
import gzip
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image
from starlette.requests import Request

from viewer.app import (
    _accepts_content_encoding,
    _configured_geometry_descriptor,
    get_configured_mesh_chunk,
    get_reprojection_colmap_points,
    _is_loopback_request,
    _matching_image_preview,
    _static_asset_version,
    set_local_reprojection_geometry,
)


class _FakeMeshStream:
    def __init__(self, cache_path):
        self.cache_path = cache_path

    def prepare_gzip_chunk(self, chunk_index):
        return self.cache_path


class _FakeGeometryService:
    def __init__(self, cache_path):
        self.cache_path = cache_path

    def get_configured_mesh_stream(self, token, version):
        return _FakeMeshStream(self.cache_path) if token == "valid" else None


class _FakeDescriptorService:
    def __init__(self):
        self.warmed = False

    def get_configured_geometry_file(self):
        return {
            "name": "mesh.ply",
            "token": "secret",
            "revision": "abc123",
            "mesh_stream": {"chunk_count": 2},
        }

    def start_configured_mesh_warmup(self):
        self.warmed = True


class _FakeColmapPointsService:
    def __init__(self):
        self.requested = False

    @staticmethod
    def has_reprojection_data():
        return True

    def iter_colmap_points_ply(self):
        self.requested = True
        return iter([b"ply\n", b"points"])


class MainImportTest(unittest.TestCase):
    def test_colmap_points_endpoint_streams_the_browser_point_cloud(self):
        service = _FakeColmapPointsService()
        with patch(
            "viewer.app.colmap_service", service, create=True
        ):
            response = get_reprojection_colmap_points()

        self.assertTrue(service.requested)
        self.assertEqual(response.media_type, "application/octet-stream")
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_server_entrypoint_imports(self):
        import main

        self.assertIsNotNone(main.app)

    def test_static_asset_version_tracks_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset = root / "app.js"
            asset.write_text("first", encoding="utf-8")
            first = _static_asset_version(root)
            asset.write_text("second", encoding="utf-8")
            second = _static_asset_version(root)
        self.assertNotEqual(first, second)

    def test_configured_geometry_access_is_loopback_only(self):
        def request(client_host):
            return Request({
                "type": "http",
                "headers": [],
                "client": (client_host, 1234),
            })

        self.assertTrue(_is_loopback_request(request("127.0.0.1")))
        self.assertTrue(_is_loopback_request(request("::1")))
        self.assertFalse(_is_loopback_request(request("192.0.2.10")))

    def test_local_geometry_selection_rejects_non_loopback_clients(self):
        request = Request({
            "type": "http",
            "headers": [],
            "client": ("192.0.2.10", 1234),
        })
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(set_local_reprojection_geometry(request))
        self.assertEqual(raised.exception.status_code, 403)

    def test_local_geometry_selection_reports_invalid_json(self):
        async def receive():
            return {
                "type": "http.request",
                "body": b"{",
                "more_body": False,
            }

        request = Request({
            "type": "http",
            "headers": [(b"content-type", b"application/json")],
            "client": ("127.0.0.1", 1234),
        }, receive)
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(set_local_reprojection_geometry(request))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Invalid JSON body")

    def test_mesh_chunks_use_negotiated_fast_gzip(self):
        request = Request({
            "type": "http",
            "headers": [(b"accept-encoding", b"gzip, deflate")],
            "client": ("127.0.0.1", 1234),
        })
        with tempfile.NamedTemporaryFile(suffix=".cvm.gz") as cached:
            cached.write(gzip.compress(b"mesh payload\x03", compresslevel=1))
            cached.flush()
            with patch(
                "viewer.app.colmap_service",
                _FakeGeometryService(cached.name),
                create=True,
            ):
                response = get_configured_mesh_chunk(
                    request, 3, "valid", "revision"
                )

            self.assertEqual(response.headers["content-encoding"], "gzip")
            self.assertIn("max-age", response.headers["cache-control"])
            self.assertEqual(
                gzip.decompress(Path(response.path).read_bytes()),
                b"mesh payload\x03",
            )

    def test_content_encoding_negotiation_honors_quality(self):
        self.assertTrue(_accepts_content_encoding("br, gzip", "gzip"))
        self.assertTrue(_accepts_content_encoding("*;q=0.5", "gzip"))
        self.assertFalse(_accepts_content_encoding("gzip;q=0", "gzip"))
        self.assertFalse(_accepts_content_encoding("gzip;q=2", "gzip"))
        self.assertFalse(_accepts_content_encoding("x-gzip", "gzip"))

    def test_geometry_urls_include_file_revision(self):
        service = _FakeDescriptorService()
        with patch("viewer.app.colmap_service", service, create=True):
            descriptor = _configured_geometry_descriptor()

        self.assertEqual(
            descriptor["url"],
            "/api/reprojection/configured-geometry"
            "?token=secret&version=abc123",
        )
        self.assertEqual(
            descriptor["mesh_stream"]["chunk_url"],
            "/api/reprojection/configured-mesh-chunks/"
            "{chunk_index}?token=secret&version=abc123",
        )
        self.assertTrue(service.warmed)

    def test_matching_preview_is_bounded_jpeg(self):
        with tempfile.NamedTemporaryFile(suffix=".png") as source:
            Image.new("RGB", (1600, 800), (20, 40, 60)).save(
                source, format="PNG"
            )
            source.flush()
            preview = _matching_image_preview(source.name, 320)

        with Image.open(io.BytesIO(preview)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (320, 160))


if __name__ == "__main__":
    unittest.main()
