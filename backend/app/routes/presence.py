# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Rich Presence routes
===================================
Privacy-First Activity-Status (à la Discord Rich Presence).

Architektur
-----------
- Aktivitäten werden NUR innerhalb des eigenen Singra-Nodes geteilt
  (kein Zentralserver, kein Telemetrie-Upload).
- Sichtbarkeit ist pro-Server konfigurierbar:
  "Zeige VS Code nur meinen Arbeitskollegen-Server, nicht im Gaming-Server."
- Der Tauri-Client erkennt aktive Prozesse und sendet sie an den Node.
- Web-Clients haben KEIN Rich Presence (kein Prozess-Zugriff).
- Aktivitäten haben ein TTL (Time-to-Live) und werden automatisch entfernt.

Datenmodell (activities Collection)
------------------------------------
{
    "user_id": str,
    "type": "playing" | "coding" | "listening" | "streaming" | "custom",
    "name": str,           # z.B. "Counter-Strike 2", "VS Code"
    "details": str | None, # z.B. "Competitive – Dust 2"
    "state": str | None,   # z.B. "In Queue"
    "started_at": str,     # ISO 8601
    "updated_at": str,
    "expires_at": str,     # TTL – nach Ablauf wird die Aktivität entfernt
    "large_image": str | None,  # URL oder Asset-Key
    "small_image": str | None,
    "visible_server_ids": [str] | None,  # None = überall sichtbar
}

Routes
------
    PUT    /api/presence/activity          – Aktivität setzen/aktualisieren
    DELETE /api/presence/activity          – Aktivität entfernen
    GET    /api/presence/activity/{user_id} – Aktivität eines Users abrufen
    GET    /api/presence/server/{server_id} – Alle sichtbaren Aktivitäten eines Servers
    PUT    /api/presence/settings          – Privacy-Einstellungen
    GET    /api/presence/settings          – Privacy-Einstellungen lesen
"""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.database import db

router = APIRouter(prefix="/api/presence", tags=["presence"])

# ── TTL: Aktivitäten verfallen nach 30 Minuten ohne Update ────────────────
ACTIVITY_TTL_MINUTES = 30


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Models ────────────────────────────────────────────────────────────────────

class ActivityInput(BaseModel):
    """Wird vom Tauri-Client gesendet wenn eine Aktivität erkannt wird."""
    type: str = "playing"  # playing, coding, listening, streaming, custom
    name: str
    details: Optional[str] = None
    state: Optional[str] = None
    large_image: Optional[str] = None
    small_image: Optional[str] = None
    # Sichtbarkeit: None = überall, Liste = nur auf diesen Servern
    visible_server_ids: Optional[list[str]] = None


class PresenceSettingsInput(BaseModel):
    """Privacy-Einstellungen für Rich Presence."""
    enabled: bool = True                    # Rich Presence global an/aus
    show_game_activity: bool = True         # Spiele anzeigen
    show_coding_activity: bool = True       # IDE-Aktivität anzeigen
    default_visibility: str = "all_servers" # "all_servers" | "selected_servers"
    default_visible_server_ids: list[str] = []


# ── Routes ────────────────────────────────────────────────────────────────────

@router.put("/activity")
async def set_activity(inp: ActivityInput, request: Request) -> dict:
    """Aktivität setzen oder aktualisieren. Wird vom Tauri-Client periodisch
    aufgerufen (Heartbeat) um das TTL zu erneuern."""
    user = await _current_user(request)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=ACTIVITY_TTL_MINUTES)

    activity = {
        "user_id": user["id"],
        "type": inp.type,
        "name": inp.name,
        "details": inp.details,
        "state": inp.state,
        "started_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "large_image": inp.large_image,
        "small_image": inp.small_image,
        "visible_server_ids": inp.visible_server_ids,
    }

    # Upsert: Wenn der User bereits eine Aktivität hat, überschreiben
    await db.activities.update_one(
        {"user_id": user["id"]},
        {"$set": activity},
        upsert=True,
    )
    activity.pop("_id", None)
    return activity


@router.delete("/activity")
async def clear_activity(request: Request) -> dict:
    """Aktivität entfernen (z.B. wenn der User das Spiel beendet)."""
    user = await _current_user(request)
    await db.activities.delete_many({"user_id": user["id"]})
    return {"cleared": True}


@router.get("/activity/{user_id}")
async def get_activity(user_id: str, request: Request) -> dict:
    """Aktivität eines bestimmten Users abrufen.
    Gibt null zurück wenn keine Aktivität oder abgelaufen."""
    await _current_user(request)  # Auth prüfen

    activity = await db.activities.find_one({"user_id": user_id}, {"_id": 0})
    if not activity:
        return {"activity": None}

    # TTL prüfen
    from datetime import datetime, timezone
    expires_at = activity.get("expires_at")
    if expires_at:
        exp = datetime.fromisoformat(expires_at) if isinstance(expires_at, str) else expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            await db.activities.delete_one({"user_id": user_id})
            return {"activity": None}

    return {"activity": activity}


@router.get("/server/{server_id}")
async def get_server_activities(server_id: str, request: Request) -> dict:
    """Alle sichtbaren Aktivitäten auf einem Server.
    Filtert nach visible_server_ids und TTL."""
    user = await _current_user(request)

    # Prüfen ob User Mitglied des Servers ist
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not member:
        raise HTTPException(403, "Kein Mitglied dieses Servers")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    # Alle nicht-abgelaufenen Aktivitäten holen die auf diesem Server sichtbar sind
    activities = await db.activities.find(
        {
            "expires_at": {"$gt": now},
            "$or": [
                {"visible_server_ids": None},           # Überall sichtbar
                {"visible_server_ids": server_id},       # Explizit für diesen Server
                {"visible_server_ids": {"$size": 0}},    # Leere Liste = überall
            ],
        },
        {"_id": 0},
    ).to_list(100)

    return {"activities": activities}


@router.put("/settings")
async def update_presence_settings(inp: PresenceSettingsInput, request: Request) -> dict:
    """Privacy-Einstellungen für Rich Presence speichern."""
    user = await _current_user(request)

    from datetime import datetime, timezone
    settings = {
        "user_id": user["id"],
        "enabled": inp.enabled,
        "show_game_activity": inp.show_game_activity,
        "show_coding_activity": inp.show_coding_activity,
        "default_visibility": inp.default_visibility,
        "default_visible_server_ids": inp.default_visible_server_ids,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.presence_settings.update_one(
        {"user_id": user["id"]},
        {"$set": settings},
        upsert=True,
    )
    settings.pop("_id", None)
    return settings


@router.get("/settings")
async def get_presence_settings(request: Request) -> dict:
    """Privacy-Einstellungen lesen. Gibt Defaults zurück wenn noch nicht gesetzt."""
    user = await _current_user(request)

    settings = await db.presence_settings.find_one(
        {"user_id": user["id"]}, {"_id": 0}
    )
    if not settings:
        settings = {
            "user_id": user["id"],
            "enabled": True,
            "show_game_activity": True,
            "show_coding_activity": True,
            "default_visibility": "all_servers",
            "default_visible_server_ids": [],
        }
    return settings
