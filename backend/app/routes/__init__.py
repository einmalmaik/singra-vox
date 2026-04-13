from __future__ import annotations

from fastapi import FastAPI

from app.routes.auth import router as auth_router
from app.routes.bots import router as bots_router
from app.routes.channels import router as channels_router
from app.routes.dm import router as dm_router
from app.routes.e2ee import router as e2ee_router
from app.routes.emojis import router as emojis_router
from app.routes.files import router as files_router
from app.routes.friends import router as friends_router
from app.routes.gdpr import router as gdpr_router
from app.routes.groups import router as groups_router
from app.routes.instance import router as instance_router
from app.routes.invites import router as invites_router
from app.routes.messages import router as messages_router
from app.routes.notifications import router as notifications_router
from app.routes.overrides import router as overrides_router
from app.routes.pins import router as pins_router
from app.routes.presence import router as presence_router
from app.routes.search import router as search_router
from app.routes.server_channels import router as server_channels_router
from app.routes.server_invites import router as server_invites_router
from app.routes.server_members import router as server_members_router
from app.routes.server_moderation import router as server_moderation_router
from app.routes.server_roles import router as server_roles_router
from app.routes.server_voice import router as server_voice_router
from app.routes.servers import router as servers_router
from app.routes.setup import router as setup_router
from app.routes.threads import router as threads_router
from app.routes.twofa import router as twofa_router
from app.routes.unread import router as unread_router
from app.routes.users import router as users_router
from app.routes.voice import router as voice_router
from app.routes.webhooks import router as webhooks_router


ROUTERS = [
    auth_router,
    e2ee_router,
    setup_router,
    instance_router,
    servers_router,
    server_channels_router,
    server_members_router,
    server_roles_router,
    server_moderation_router,
    server_invites_router,
    server_voice_router,
    voice_router,
    channels_router,
    messages_router,
    dm_router,
    invites_router,
    users_router,
    threads_router,
    search_router,
    unread_router,
    overrides_router,
    groups_router,
    gdpr_router,
    pins_router,
    notifications_router,
    emojis_router,
    presence_router,
    webhooks_router,
    bots_router,
    files_router,
    twofa_router,
    friends_router,
]


def register_routers(app: FastAPI) -> None:
    for router in ROUTERS:
        app.include_router(router)
