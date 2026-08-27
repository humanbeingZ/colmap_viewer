import unittest

from starlette.requests import Request

from viewer.app import _is_loopback_request


class MainImportTest(unittest.TestCase):
    def test_server_entrypoint_imports(self):
        import main

        self.assertIsNotNone(main.app)

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


if __name__ == "__main__":
    unittest.main()
