from __future__ import annotations

import asyncio
import logging

import jwt as pyjwt
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.auth_service import load_active_session
from app.core.config import JWT_ALG, VOICE_CLEANUP_GRACE_SECONDS, allow_origins, tauri_origin_re
from app.core.database import db
from app.core.utils import now_utc
from app.services.presence import broadcast_presence_update, log_status_history
from app.services.server_ops import clear_voice_membership
from app.ws import ws_mgr


logger = logging.getLogger(__name__)
_pending_voice_cleanups: dict[str, asyncio.Task] = {}


class WebSocketCORSBypass:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            raw_headers = list(scope.get("headers", []))
            origin = ""
            for key, value in raw_headers:
                if key == b"origin":
                    origin = value.decode("utf-8", errors="ignore").strip()
                    break

            if origin and origin not in allow_origins and not tauri_origin_re.match(origin):
                from starlette.responses import PlainTextResponse

                response = PlainTextResponse("Origin nicht erlaubt", status_code=403)
                await response(scope, receive, send)
                return

            scope = dict(scope)
            scope["headers"] = [(key, value) for key, value in raw_headers if key != b"origin"]

        await self.app(scope, receive, send)


def configure_websocket_cors(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(WebSocketCORSBypass)


def _cancel_pending_voice_cleanup(uid: str) -> None:
    task = _pending_voice_cleanups.pop(uid, None)
    if task and not task.done():
        task.cancel()


def _schedule_deferred_voice_cleanup(uid: str) -> None:
    _cancel_pending_voice_cleanup(uid)

    async def _do_cleanup():
        try:
            await asyncio.sleep(VOICE_CLEANUP_GRACE_SECONDS)
            if uid not in ws_mgr.conns:
                await clear_voice_membership(uid)
        except asyncio.CancelledError:
            pass
        finally:
            _pending_voice_cleanups.pop(uid, None)

    _pending_voice_cleanups[uid] = asyncio.create_task(_do_cleanup())


def register_ws_routes(app: FastAPI) -> None:
    @app.websocket("/api/ws")
    async def ws_endpoint(websocket: WebSocket, token: str = Query(None), platform: str = Query("web")):
        ws_token = token or websocket.cookies.get("access_token")
        if not ws_token:
            await websocket.close(code=4001)
            return

        try:
            auth_config = websocket.app.state.auth_config
            payload = pyjwt.decode(ws_token, auth_config.jwt_secret, algorithms=[JWT_ALG])
            if payload.get("type") != "access" or not payload.get("sid"):
                await websocket.close(code=4001)
                return
            session = await load_active_session(db, session_id=payload["sid"])
            if not session:
                await websocket.close(code=4001)
                return
            uid = payload["sub"]
            user = await db.users.find_one({"id": uid}, {"_id": 0})
            if not user:
                await websocket.close(code=4001)
                return
        except Exception:
            await websocket.close(code=4001)
            return

        connection_id = await ws_mgr.connect(websocket, uid, platform, payload["sid"])
        _cancel_pending_voice_cleanup(uid)

        if uid not in ws_mgr.user_servers:
            members = await db.server_members.find(
                {"user_id": uid, "is_banned": {"$ne": True}},
                {"_id": 0, "server_id": 1},
            ).to_list(100)
            ws_mgr.user_servers[uid] = {member["server_id"] for member in members}

        if len(ws_mgr.conns[uid]) == 1:
            preferred = user.get("preferred_status", user.get("status", "online"))
            if preferred != "offline":
                await db.users.update_one(
                    {"id": uid},
                    {"$set": {"status": preferred, "last_seen": now_utc()}},
                )
                await log_status_history(uid, preferred)
                await broadcast_presence_update(uid)

        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "typing":
                    channel = await db.channels.find_one({"id": data.get("channel_id")}, {"_id": 0})
                    if channel:
                        await ws_mgr.broadcast_server(
                            channel["server_id"],
                            {
                                "type": "typing",
                                "user_id": uid,
                                "channel_id": data["channel_id"],
                                "username": user.get("display_name", user.get("username", "")),
                            },
                            exclude=uid,
                        )
                elif data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.error("WS error: %s", exc)
        finally:
            remaining_connections = ws_mgr.disconnect(uid, connection_id)
            if remaining_connections == 0:
                await db.users.update_one(
                    {"id": uid},
                    {"$set": {"status": "offline", "last_seen": now_utc()}},
                )
                await log_status_history(uid, "offline")
                await broadcast_presence_update(uid)
                _schedule_deferred_voice_cleanup(uid)
