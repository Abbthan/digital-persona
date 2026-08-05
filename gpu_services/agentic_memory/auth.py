from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException


@dataclass(frozen=True)
class SessionClaims:
    uid: str
    pid: str
    exp: float


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def decode_session_token(token: str) -> SessionClaims | None:
    secret = os.environ.get("LIVETALKING_SESSION_SECRET")
    if not secret or not token:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        signature = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
        expected = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
        if not hmac.compare_digest(expected, sig_b64):
            return None
        raw = json.loads(_b64url_decode(payload_b64))
        claims = SessionClaims(
            uid=str(raw.get("uid", "")), pid=str(raw.get("pid", "")),
            exp=float(raw.get("exp", 0)),
        )
        return claims if claims.exp >= time.time() and claims.pid else None
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def require_system_claims(authorization: str | None = Header(default=None)) -> SessionClaims:
    prefix = "Bearer "
    token = authorization[len(prefix):] if authorization and authorization.startswith(prefix) else ""
    claims = decode_session_token(token)
    if claims is None or claims.uid != "system":
        raise HTTPException(status_code=401, detail="unauthorized")
    return claims


def require_matching_persona(claims: SessionClaims, persona_id: str) -> None:
    if not hmac.compare_digest(claims.pid, persona_id):
        raise HTTPException(status_code=403, detail="token is not scoped to this persona")
