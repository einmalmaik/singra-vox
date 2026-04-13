from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app


def test_app_import_registers_core_http_and_ws_routes():
    paths = {route.path for route in app.routes}

    assert "/api/health" in paths
    assert "/api/ws" in paths
    assert "/api/auth/register" in paths
    assert "/api/e2ee/state" in paths
    assert "/api/servers" in paths
    assert "/api/servers/{server_id}/channels" in paths
    assert "/api/channels/{channel_id}/messages" in paths
    assert "/api/messages/{message_id}" in paths
    assert "/api/dm/{other_user_id}" in paths
    assert "/api/invites/{code}" in paths
    assert "/api/users/search" in paths


def test_app_auth_config_is_initialized():
    auth_config = app.state.auth_config

    assert auth_config.jwt_secret
    assert isinstance(auth_config.cookie_secure, bool)
