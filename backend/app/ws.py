import uuid
import logging
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

def new_id():
    return str(uuid.uuid4())

class WSManager:
    def __init__(self):
        # uid -> connection_id -> (websocket, platform)
        self.conns: Dict[str, Dict[str, tuple]] = {}
        self.user_servers: Dict[str, set] = {}

    async def connect(self, ws: WebSocket, uid: str, platform: str = "web"):
        await ws.accept()
        connection_id = new_id()
        self.conns.setdefault(uid, {})[connection_id] = (ws, platform)
        return connection_id

    def disconnect(self, uid: str, connection_id: str) -> int:
        user_connections = self.conns.get(uid)
        if not user_connections:
            return 0
        user_connections.pop(connection_id, None)
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
        for connection_id, (ws, platform) in list(user_connections.items()):
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
        return {platform for _, platform in user_connections.values()}

ws_mgr = WSManager()
