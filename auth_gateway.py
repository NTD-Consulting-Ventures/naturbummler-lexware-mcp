"""Cargoboard-kompatibler Microsoft-Entra-OAuth-Proxy für den Lexware-MCP."""

from __future__ import annotations

import ipaddress
import os
import re
import uuid
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from fastmcp import FastMCP
from fastmcp.server.auth.providers.azure import AzureProvider
from key_value.aio.stores.memory import MemoryStore
from key_value.aio.stores.redis import RedisStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from starlette.requests import Request
from starlette.responses import JSONResponse


_SCOPE_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"


def _required(name: str, *, min_length: int = 1) -> str:
    value = os.getenv(name, "").strip()
    if len(value) < min_length:
        raise RuntimeError(f"{name} fehlt oder ist ungültig")
    return value


def _uuid(name: str) -> str:
    value = _required(name)
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} muss eine UUID sein") from exc
    return value


def _public_base_url() -> str:
    value = (os.getenv("MCP_PUBLIC_BASE_URL") or os.getenv("SERVER_URL") or "").strip().rstrip("/")
    parsed = urlsplit(value)
    is_loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_loopback):
        raise RuntimeError("MCP_PUBLIC_BASE_URL muss HTTPS verwenden")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise RuntimeError("MCP_PUBLIC_BASE_URL muss eine reine Origin-URL sein")
    return value


def _redirect_uris() -> list[str]:
    configured = os.getenv("MCP_ALLOWED_REDIRECT_URIS", "").strip()
    return [item.strip() for item in configured.split(",") if item.strip()] or [_CLAUDE_REDIRECT_URI]


def _storage():
    if os.getenv("OAUTH_STORAGE_BACKEND", "redis").strip().lower() == "memory":
        if urlsplit(_public_base_url()).hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise RuntimeError("In-Memory-OAuth-Speicher ist nur auf Loopback erlaubt")
        return MemoryStore()
    encryption_key = _required("OAUTH_STORAGE_ENCRYPTION_KEY", min_length=32)
    try:
        fernet = Fernet(encryption_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise RuntimeError("OAUTH_STORAGE_ENCRYPTION_KEY ist kein gültiger Fernet-Schlüssel") from exc
    return FernetEncryptionWrapper(
        key_value=RedisStore(
            url=_required("REDIS_URL"),
            default_collection="naturbummler-lexware-mcp-oauth",
        ),
        fernet=fernet,
    )


def _provider() -> AzureProvider:
    scope = os.getenv("ENTRA_SCOPE", "mcp.access").strip()
    if not _SCOPE_PATTERN.fullmatch(scope):
        raise RuntimeError("ENTRA_SCOPE ist ungültig")
    return AzureProvider(
        client_id=_uuid("ENTRA_CLIENT_ID"),
        client_secret=_required("ENTRA_CLIENT_SECRET", min_length=16),
        tenant_id=_uuid("ENTRA_TENANT_ID"),
        identifier_uri=os.getenv("ENTRA_IDENTIFIER_URI", "").strip() or None,
        base_url=_public_base_url(),
        required_scopes=[scope],
        additional_authorize_scopes=["openid", "profile", "email", "offline_access"],
        allowed_client_redirect_uris=_redirect_uris(),
        client_storage=_storage(),
        jwt_signing_key=_required("OAUTH_JWT_SIGNING_KEY", min_length=32),
        require_authorization_consent=True,
    )


provider = _provider()
app = FastMCP("Naturbummler · Lexware OAuth", auth=provider)


def _is_loopback(request: Request) -> bool:
    try:
        return bool(request.client and ipaddress.ip_address(request.client.host).is_loopback)
    except ValueError:
        return False


@app.custom_route("/__internal/status", methods=["GET"], include_in_schema=False)
async def internal_status(request: Request) -> JSONResponse:
    if not _is_loopback(request):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"status": "ok"})


@app.custom_route("/__internal/verify", methods=["POST"], include_in_schema=False)
async def internal_verify(request: Request) -> JSONResponse:
    """Validiert FastMCP- und dahinterliegendes Entra-Token nur über Loopback."""
    if not _is_loopback(request):
        return JSONResponse({"error": "not_found"}, status_code=404)
    try:
        payload = await request.json()
        token = payload.get("token") if isinstance(payload, dict) else None
    except Exception:
        token = None
    if not isinstance(token, str) or not token:
        return JSONResponse({"active": False}, status_code=401)
    verified = await provider.verify_token(token)
    if verified is None:
        return JSONResponse({"active": False}, status_code=401)
    claims = verified.claims or {}
    return JSONResponse(
        {
            "active": True,
            "client_id": verified.client_id,
            "scopes": verified.scopes,
            "expires_at": verified.expires_at,
            "subject": verified.subject,
            "entra": {
                "tid": claims.get("tid"),
                "ver": claims.get("ver"),
                "oid": claims.get("oid"),
                "azp": claims.get("azp"),
                "idtyp": claims.get("idtyp"),
                "roles": claims.get("roles", []),
                "groups": claims.get("groups", []),
            },
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("AUTH_INTERNAL_PORT", "8091"))
    app.run(
        transport="http",
        host="127.0.0.1",
        port=port,
        path="/mcp",
        show_banner=False,
        stateless_http=True,
        uvicorn_config={"access_log": False, "server_header": False},
    )
