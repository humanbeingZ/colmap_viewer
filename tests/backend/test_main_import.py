import asyncio
from pathlib import Path
import tempfile
import unittest

from fastapi import HTTPException
from starlette.requests import Request

from viewer.app import (
    _is_loopback_request,
    _static_asset_version,
    set_local_reprojection_geometry,
)


class MainImportTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
