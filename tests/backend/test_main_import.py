import unittest


class MainImportTest(unittest.TestCase):
    def test_server_entrypoint_imports(self):
        import main

        self.assertIsNotNone(main.app)


if __name__ == "__main__":
    unittest.main()
