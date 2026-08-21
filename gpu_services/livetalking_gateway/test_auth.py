import base64
import hashlib
import hmac
import json
import unittest

from gpu_services.livetalking_gateway.auth import AuthError, verify_session_token


def token(payload: dict, secret: str) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{encoded}.{signature}"


class AuthTests(unittest.TestCase):
    def test_valid_token(self):
        identity = verify_session_token(token({"uid": "u1", "pid": "p1", "exp": 101}, "secret"), "secret", now=100)
        self.assertEqual(identity.user_id, "u1")
        self.assertEqual(identity.persona_id, "p1")

    def test_expired_token(self):
        with self.assertRaises(AuthError):
            verify_session_token(token({"uid": "u1", "pid": "p1", "exp": 99}, "secret"), "secret", now=100)

    def test_tampered_token(self):
        with self.assertRaises(AuthError):
            verify_session_token(token({"uid": "u1", "pid": "p1", "exp": 101}, "secret") + "x", "secret", now=100)


if __name__ == "__main__":
    unittest.main()
