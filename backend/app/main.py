# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox backend application.

This module is the composition root only. Feature logic lives in routers,
shared dependencies, and services.
"""

from fastapi import FastAPI

from app.auth_service import AuthConfig
from app.core.config import APP_NAME, cookie_secure, jwt_secret
from app.core.database import db
from app.identity.routes import mount_identity_routes
from app.routes import register_routers
from app.services.lifecycle import register_lifecycle_handlers
from app.ws_routes import configure_websocket_cors, register_ws_routes


app = FastAPI(title=APP_NAME, version="1.0.0")
app.state.auth_config = AuthConfig(jwt_secret=jwt_secret, cookie_secure=cookie_secure)

configure_websocket_cors(app)
register_routers(app)
mount_identity_routes(app, db)
register_ws_routes(app)
register_lifecycle_handlers(app)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": APP_NAME}
