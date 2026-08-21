from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


class AuthError(ValueError):
    """Raised when an ECHO live-session token is invalid."""


@dataclass(frozen=True)
class SessionIdentity:
    user_id: str
    persona_id: str
    expires_at: int


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as error:
        raise AuthError("invalid token encoding") from error


def verify_session_token(token: str, secret: str, now: int | None = None) -> SessionIdentity:
    if not token or not secret:
        raise AuthError("missing token or server secret")
    try:
        payload_b64, supplied_signature = token.split(".", 1)
    except ValueError as error:
        raise AuthError("malformed token") from error

    expected_signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise AuthError("invalid token signature")

    try:
        payload = json.loads(_decode_base64url(payload_b64))
        user_id = str(payload["uid"])
        persona_id = str(payload["pid"])
        expires_at = int(payload["exp"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise AuthError("invalid token payload") from error

    if not user_id or not persona_id:
        raise AuthError("token identity is empty")
    if expires_at < (int(time.time()) if now is None else now):
        raise AuthError("token expired")
    return SessionIdentity(user_id=user_id, persona_id=persona_id, expires_at=expires_at)
