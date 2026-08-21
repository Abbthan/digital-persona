import unittest

from gpu_services.livetalking_gateway.media import safe_filename, validate_private_media_url


class MediaTests(unittest.TestCase):
    def test_safe_filename(self):
        self.assertEqual(safe_filename("../../face recording.webm"), "face_recording.webm")

    def test_rejects_untrusted_url(self):
        with self.assertRaises(ValueError):
            validate_private_media_url("https://example.com/api/internal/persona-media/p/a")

    def test_accepts_app_media_url(self):
        validate_private_media_url("https://echodigitalpersona.com/api/internal/persona-media/p/a")


if __name__ == "__main__":
    unittest.main()
