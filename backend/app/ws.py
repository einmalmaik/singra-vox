import uuid
import logging
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

def new_id():
    return str(uuid.uuid4())

class WSManager:
    def __init__(self):
        # uid -> connection_id -> (websocket, platform, session_id)
        self.conns: Dict[str, Dict[str, tuple]] = {}
        self.user_servers: Dict[str, set] = {}
        self.session_conns: Dict[str, set] = {}

    async def connect(self, ws: WebSocket, uid: str, platform: str = "web", session_id: Optional[str] = None):
        await ws.accept()
        connection_id = new_id()
        self.conns.setdefault(uid, {})[connection_id] = (ws, platform, session_id)
        if session_id:
            self.session_conns.setdefault(session_id, set()).add((uid, connection_id))
        return connection_id

    def disconnect(self, uid: str, connection_id: str) -> int:
        user_connections = self.conns.get(uid)
        if not user_connections:
            return 0
        connection = user_connections.pop(connection_id, None)
        if connection:
            _ws, _platform, session_id = connection
            if session_id and session_id in self.session_conns:
                self.session_conns[session_id].discard((uid, connection_id))
                if not self.session_conns[session_id]:
                    self.session_conns.pop(session_id, None)
        if user_connections:
            return len(user_connections)
        self.conns.pop(uid, None)
        self.user_servers.pop(uid, None)
        return 0

    async def send(self, uid: str, data: dict):
        user_connections = self.conns.get(uid)
        if not user_connections:
            return

        stale_connection_ids = []
        for connection_id, (ws, _platform, _session_id) in list(user_connections.items()):
            try:
                await ws.send_json(data)
            except Exception:
                stale_connection_ids.append(connection_id)

        for connection_id in stale_connection_ids:
            self.disconnect(uid, connection_id)

    async def broadcast_server(self, sid: str, data: dict, exclude: str = None):
        for uid, svrs in list(self.user_servers.items()):
            if sid in svrs and uid != exclude:
                await self.send(uid, data)

    def add_server(self, uid: str, sid: str):
        if uid in self.user_servers:
            self.user_servers[uid].add(sid)

    def remove_server(self, uid: str, sid: str):
        if uid in self.user_servers:
            self.user_servers[uid].discard(sid)

    def get_platforms(self, uid: str) -> Set[str]:
        user_connections = self.conns.get(uid)
        if not user_connections:
            return set()
        return {platform for _, platform, _ in user_connections.values()}

    async def close_session(self, session_id: str, payload: Optional[dict] = None, code: int = 4001):
        targets = list(self.session_conns.get(session_id) or [])
        for uid, connection_id in targets:
            user_connections = self.conns.get(uid) or {}
            connection = user_connections.get(connection_id)
            if not connection:
                self.disconnect(uid, connection_id)
                continue
            ws, _platform, _session_id = connection
            try:
                if payload:
                    await ws.send_json(payload)
            except Exception:
                pass
            try:
                await ws.close(code=code)
            except Exception:
                pass
            self.disconnect(uid, connection_id)

    async def close_user_sessions(
        self,
        uid: str,
        payload: Optional[dict] = None,
        *,
        exclude_session_id: Optional[str] = None,
        code: int = 4001,
    ):
        user_connections = list((self.conns.get(uid) or {}).items())
        for connection_id, (ws, _platform, session_id) in user_connections:
            if exclude_session_id and session_id == exclude_session_id:
                continue
            try:
                if payload:
                    await ws.send_json(payload)
            except Exception:
                pass
            try:
                await ws.close(code=code)
            except Exception:
                pass
            self.disconnect(uid, connection_id)

ws_mgr = WSManager()
