import base64
import hashlib
import hmac
import json
import os
import sys
import time
import types
import unittest
from unittest.mock import patch

try:
    import fastapi  # noqa: F401
except ModuleNotFoundError:
    stub = types.ModuleType("fastapi")
    stub.Header = lambda default=None: default
    stub.HTTPException = RuntimeError
    sys.modules["fastapi"] = stub

from auth import decode_session_token
from prompts import compose_prompt


def token(payload: dict, secret: str) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


class AgenticMemoryTests(unittest.TestCase):
    def test_scoped_claims(self):
        with patch.dict(os.environ, {"LIVETALKING_SESSION_SECRET": "secret"}):
            claims = decode_session_token(
                token({"uid": "system", "pid": "p1", "exp": time.time() + 60}, "secret")
            )
        self.assertIsNotNone(claims)
        self.assertEqual(claims.pid, "p1")

    def test_expired_and_modified_tokens(self):
        with patch.dict(os.environ, {"LIVETALKING_SESSION_SECRET": "secret"}):
            value = token({"uid": "system", "pid": "p1", "exp": time.time() - 1}, "secret")
            self.assertIsNone(decode_session_token(value))
            self.assertIsNone(decode_session_token(value + "x"))

    def test_graph_context_and_question_are_composed(self):
        result = compose_prompt(
            "Ethan", "What happened?", [{"text": "past chat"}], [], [],
            [{"text": "Ethan founded ECHO."}], [{"text": "often says lowkey"}],
            {"relations": [{"subject": "Ethan", "predicate": "founded",
                            "object": "ECHO", "time": "2026"}],
             "timeline": [{"event": "launched ECHO", "time_expression": "2026"}],
             "guided_questions": [{"question": "What inspired it?"}]},
        )
        self.assertIn("Ethan —founded→ ECHO", result)
        self.assertIn("often says lowkey", result)
        self.assertIn("What inspired it?", result)

if __name__ == "__main__":
    unittest.main()
