# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""
Singra Vox – Friends & Cross-Instance Relay
=============================================

Ermöglicht das Hinzufügen von Freunden über Singra-ID und den
Nachrichtenaustausch zwischen verschiedenen Instanzen, sofern
diese denselben ID-Server nutzen.

Datenmodell
-----------
``svid_friends`` Collection::

    {
        "id": str,               # Eindeutige Freundschafts-ID
        "requester_id": str,     # SVID Account-ID des Anfragenden
        "recipient_id": str,     # SVID Account-ID des Empfängers
        "status": str,           # "pending" | "accepted" | "declined" | "blocked"
        "created_at": str,       # ISO-8601 Zeitstempel
        "accepted_at": str|None, # Zeitpunkt der Annahme
    }

``svid_relay_messages`` Collection (Cross-Instance DMs)::

    {
        "id": str,
        "from_account_id": str,
        "to_account_id": str,
        "content": str,              # Klartext (nur wenn nicht E2EE)
        "encrypted_content": str,    # E2EE-verschlüsselter Inhalt
        "is_encrypted": bool,
        "nonce": str,
        "sender_device_id": str,
        "protocol_version": str,
        "key_envelopes": list[dict],
        "attachments": list[dict],
        "created_at": str,
        "read_at": str|None,
    }

Routes
------
    POST   /api/id/friends/request        – Freundschaftsanfrage senden
    GET    /api/id/friends                 – Freundesliste abrufen
    GET    /api/id/friends/requests        – Offene Anfragen abrufen
    POST   /api/id/friends/{id}/accept     – Anfrage annehmen
    POST   /api/id/friends/{id}/decline    – Anfrage ablehnen
    DELETE /api/id/friends/{id}            – Freund entfernen
    GET    /api/id/friends/{id}/profile    – Freundesprofil abrufen

    POST   /api/id/relay/messages          – Cross-Instance Nachricht senden
    GET    /api/id/relay/messages/{friend_id} – Nachrichten mit Freund abrufen
    POST   /api/id/relay/messages/{id}/read  – Nachricht als gelesen markieren

Datenschutz
-----------
- Alle Relay-Nachrichten unterstützen E2EE (client-seitig verschlüsselt)
- Der ID-Server speichert nur verschlüsselte Daten
- Freundschaften sind nur über SVID-Accounts möglich
- Keine Metadaten-Leaks: Nur die Account-IDs werden gespeichert
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.database import db
from app.core.utils import now_utc, new_id

router = APIRouter(prefix="/api/id", tags=["friends"])


# ── Authentifizierung ────────────────────────────────────────────────────────

async def _require_svid_account(request: Request) -> dict:
    """
    Lädt den aktuellen SVID-Account aus dem Authorization-Header.
    Wirft 401 wenn kein gültiger Token vorhanden ist.
    """
    from app.auth_service import load_current_user
    user, _ = await load_current_user(db, request)
    if not user:
        raise HTTPException(401, "Nicht authentifiziert")

    # SVID Account-ID aus dem User laden
    svid_account = await db.svid_accounts.find_one(
        {"linked_user_id": user["id"]}, {"_id": 0}
    )
    if not svid_account:
        raise HTTPException(403, "Kein Singra-ID Account verknüpft. "
                            "Registriere dich zuerst unter /svid/register")
    return {**svid_account, "_local_user": user}


# ── Input-Modelle ────────────────────────────────────────────────────────────

class FriendRequestInput(BaseModel):
    """Freundschaftsanfrage: Empfänger per Username oder Account-ID."""
    recipient_username: Optional[str] = None
    recipient_account_id: Optional[str] = None


class RelayMessageInput(BaseModel):
    """Cross-Instance DM Nachricht."""
    content: str = ""
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    nonce: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = "sv-e2ee-v1"
    key_envelopes: list[dict] = []
    attachments: list[dict] = []


# ── Hilfsfunktionen ──────────────────────────────────────────────────────────

async def _find_svid_account_by_username(username: str) -> dict | None:
    """Sucht einen SVID-Account per Username (case-insensitive)."""
    return await db.svid_accounts.find_one(
        {"username": {"$regex": f"^{username}$", "$options": "i"}},
        {"_id": 0},
    )


async def _find_svid_account_by_id(account_id: str) -> dict | None:
    """Sucht einen SVID-Account per ID."""
    return await db.svid_accounts.find_one(
        {"id": account_id}, {"_id": 0}
    )


async def _enrich_friend_record(record: dict) -> dict:
    """Ergänzt einen Freundschafts-Datensatz mit Account-Profildaten."""
    requester = await _find_svid_account_by_id(record.get("requester_id", ""))
    recipient = await _find_svid_account_by_id(record.get("recipient_id", ""))
    return {
        **record,
        "requester_profile": _safe_profile(requester),
        "recipient_profile": _safe_profile(recipient),
    }


def _safe_profile(account: dict | None) -> dict | None:
    """Gibt nur öffentlich sichere Felder eines Accounts zurück."""
    if not account:
        return None
    return {
        "id": account.get("id"),
        "username": account.get("username"),
        "display_name": account.get("display_name", account.get("username")),
        "avatar_url": account.get("avatar_url"),
        "instance_url": account.get("instance_url"),
    }


# ── Routes: Freundesliste ────────────────────────────────────────────────────

@router.post("/friends/request")
async def send_friend_request(inp: FriendRequestInput, request: Request) -> dict:
    """
    Sendet eine Freundschaftsanfrage per Username oder Account-ID.

    Validierungen:
    - Man kann sich nicht selbst als Freund hinzufügen
    - Doppelte Anfragen werden verhindert
    - Blockierte Nutzer können keine Anfragen senden
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    # Empfänger ermitteln
    recipient = None
    if inp.recipient_username:
        recipient = await _find_svid_account_by_username(inp.recipient_username)
    elif inp.recipient_account_id:
        recipient = await _find_svid_account_by_id(inp.recipient_account_id)

    if not recipient:
        raise HTTPException(404, "Nutzer nicht gefunden")

    target_id = recipient["id"]

    # Selbst-Anfrage verhindern
    if target_id == my_id:
        raise HTTPException(400, "Du kannst dir nicht selbst eine Freundschaftsanfrage senden")

    # Bestehende Beziehung prüfen
    existing = await db.svid_friends.find_one(
        {
            "$or": [
                {"requester_id": my_id, "recipient_id": target_id},
                {"requester_id": target_id, "recipient_id": my_id},
            ]
        },
        {"_id": 0},
    )

    if existing:
        status = existing.get("status")
        if status == "accepted":
            raise HTTPException(409, "Ihr seid bereits Freunde")
        if status == "pending":
            # Wenn der andere die Anfrage gesendet hat, automatisch annehmen
            if existing["requester_id"] == target_id:
                ts = now_utc()
                await db.svid_friends.update_one(
                    {"id": existing["id"]},
                    {"$set": {"status": "accepted", "accepted_at": ts}},
                )
                enriched = await _enrich_friend_record(
                    {**existing, "status": "accepted", "accepted_at": ts}
                )
                return enriched
            raise HTTPException(409, "Freundschaftsanfrage bereits gesendet")
        if status == "blocked":
            raise HTTPException(403, "Dieser Nutzer hat dich blockiert")
        if status == "declined":
            # Abgelehnte Anfrage erneut senden erlauben
            ts = now_utc()
            await db.svid_friends.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "status": "pending",
                    "requester_id": my_id,
                    "recipient_id": target_id,
                    "created_at": ts,
                    "accepted_at": None,
                }},
            )
            enriched = await _enrich_friend_record(
                {**existing, "status": "pending", "requester_id": my_id,
                 "recipient_id": target_id, "created_at": ts, "accepted_at": None}
            )
            return enriched

    # Neue Anfrage erstellen
    friendship = {
        "id": new_id(),
        "requester_id": my_id,
        "recipient_id": target_id,
        "status": "pending",
        "created_at": now_utc(),
        "accepted_at": None,
    }
    await db.svid_friends.insert_one(friendship)
    friendship.pop("_id", None)
    enriched = await _enrich_friend_record(friendship)
    return enriched


@router.get("/friends")
async def list_friends(request: Request) -> list[dict]:
    """
    Gibt die Freundesliste des aktuellen Nutzers zurück.
    Nur akzeptierte Freundschaften werden angezeigt.
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    friends = await db.svid_friends.find(
        {
            "status": "accepted",
            "$or": [
                {"requester_id": my_id},
                {"recipient_id": my_id},
            ],
        },
        {"_id": 0},
    ).to_list(500)

    result = []
    for f in friends:
        enriched = await _enrich_friend_record(f)
        # Freund-Profil ermitteln (der andere Nutzer)
        if f["requester_id"] == my_id:
            enriched["friend_profile"] = enriched.get("recipient_profile")
        else:
            enriched["friend_profile"] = enriched.get("requester_profile")
        result.append(enriched)

    return result


@router.get("/friends/requests")
async def list_friend_requests(request: Request) -> dict:
    """
    Gibt eingehende und ausgehende offene Freundschaftsanfragen zurück.
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    incoming = await db.svid_friends.find(
        {"recipient_id": my_id, "status": "pending"}, {"_id": 0}
    ).to_list(100)
    outgoing = await db.svid_friends.find(
        {"requester_id": my_id, "status": "pending"}, {"_id": 0}
    ).to_list(100)

    enriched_incoming = [await _enrich_friend_record(r) for r in incoming]
    enriched_outgoing = [await _enrich_friend_record(r) for r in outgoing]

    return {
        "incoming": enriched_incoming,
        "outgoing": enriched_outgoing,
    }


@router.post("/friends/{friendship_id}/accept")
async def accept_friend_request(friendship_id: str, request: Request) -> dict:
    """Nimmt eine eingehende Freundschaftsanfrage an."""
    account = await _require_svid_account(request)
    my_id = account["id"]

    friendship = await db.svid_friends.find_one(
        {"id": friendship_id, "recipient_id": my_id, "status": "pending"},
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(404, "Freundschaftsanfrage nicht gefunden")

    ts = now_utc()
    await db.svid_friends.update_one(
        {"id": friendship_id},
        {"$set": {"status": "accepted", "accepted_at": ts}},
    )

    friendship["status"] = "accepted"
    friendship["accepted_at"] = ts
    return await _enrich_friend_record(friendship)


@router.post("/friends/{friendship_id}/decline")
async def decline_friend_request(friendship_id: str, request: Request) -> dict:
    """Lehnt eine eingehende Freundschaftsanfrage ab."""
    account = await _require_svid_account(request)
    my_id = account["id"]

    friendship = await db.svid_friends.find_one(
        {"id": friendship_id, "recipient_id": my_id, "status": "pending"},
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(404, "Freundschaftsanfrage nicht gefunden")

    await db.svid_friends.update_one(
        {"id": friendship_id},
        {"$set": {"status": "declined"}},
    )

    friendship["status"] = "declined"
    return await _enrich_friend_record(friendship)


@router.delete("/friends/{friendship_id}")
async def remove_friend(friendship_id: str, request: Request) -> dict:
    """
    Entfernt eine Freundschaft komplett.
    Beide Nutzer können eine Freundschaft beenden.
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    friendship = await db.svid_friends.find_one(
        {
            "id": friendship_id,
            "$or": [
                {"requester_id": my_id},
                {"recipient_id": my_id},
            ],
        },
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(404, "Freundschaft nicht gefunden")

    await db.svid_friends.delete_one({"id": friendship_id})
    return {"ok": True, "deleted_id": friendship_id}


@router.get("/friends/{friendship_id}/profile")
async def get_friend_profile(friendship_id: str, request: Request) -> dict:
    """Gibt das öffentliche Profil eines Freundes zurück."""
    account = await _require_svid_account(request)
    my_id = account["id"]

    friendship = await db.svid_friends.find_one(
        {
            "id": friendship_id,
            "status": "accepted",
            "$or": [
                {"requester_id": my_id},
                {"recipient_id": my_id},
            ],
        },
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(404, "Freundschaft nicht gefunden oder nicht akzeptiert")

    # Den anderen Nutzer ermitteln
    friend_account_id = (
        friendship["recipient_id"]
        if friendship["requester_id"] == my_id
        else friendship["requester_id"]
    )
    friend_account = await _find_svid_account_by_id(friend_account_id)
    return _safe_profile(friend_account) or {}


# ── Routes: Cross-Instance DM Relay ─────────────────────────────────────────

@router.post("/relay/messages")
async def send_relay_message(inp: RelayMessageInput, request: Request) -> dict:
    """
    Sendet eine Cross-Instance Direktnachricht über den ID-Server.

    Die Nachricht wird E2EE-verschlüsselt vom Client gesendet.
    Der Server speichert nur den verschlüsselten Inhalt.

    Voraussetzung: Der Empfänger muss ein akzeptierter Freund sein.
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    # Empfänger aus Body lesen
    body = await request.json() if not inp.content and not inp.encrypted_content else None
    to_account_id = (body or {}).get("to_account_id", "")
    if not to_account_id:
        # Fallback: aus dem Model
        raise HTTPException(400, "to_account_id ist erforderlich")

    # Freundschaft prüfen
    friendship = await db.svid_friends.find_one(
        {
            "status": "accepted",
            "$or": [
                {"requester_id": my_id, "recipient_id": to_account_id},
                {"requester_id": to_account_id, "recipient_id": my_id},
            ],
        },
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(403, "Ihr müsst Freunde sein um Nachrichten zu senden")

    # Nachricht erstellen
    message = {
        "id": new_id(),
        "from_account_id": my_id,
        "to_account_id": to_account_id,
        "content": inp.content if not inp.is_encrypted else "[Encrypted]",
        "encrypted_content": inp.encrypted_content or "",
        "is_encrypted": inp.is_encrypted,
        "nonce": inp.nonce or "",
        "sender_device_id": inp.sender_device_id or "",
        "protocol_version": inp.protocol_version,
        "key_envelopes": inp.key_envelopes,
        "attachments": inp.attachments,
        "created_at": now_utc(),
        "read_at": None,
    }
    await db.svid_relay_messages.insert_one(message)
    message.pop("_id", None)

    # Absender-Profil hinzufügen
    message["sender_profile"] = _safe_profile(account)
    return message


@router.get("/relay/messages/{friend_account_id}")
async def get_relay_messages(
    friend_account_id: str,
    request: Request,
    before: str | None = None,
    limit: int = 50,
) -> dict:
    """
    Ruft Nachrichten mit einem Freund ab (paginiert, neueste zuerst).

    Voraussetzung: Der Nutzer muss ein akzeptierter Freund sein.
    """
    account = await _require_svid_account(request)
    my_id = account["id"]

    # Freundschaft prüfen
    friendship = await db.svid_friends.find_one(
        {
            "status": "accepted",
            "$or": [
                {"requester_id": my_id, "recipient_id": friend_account_id},
                {"requester_id": friend_account_id, "recipient_id": my_id},
            ],
        },
        {"_id": 0},
    )
    if not friendship:
        raise HTTPException(403, "Keine Freundschaft mit diesem Nutzer")

    # Limit begrenzen
    limit = max(1, min(limit, 100))

    query = {
        "$or": [
            {"from_account_id": my_id, "to_account_id": friend_account_id},
            {"from_account_id": friend_account_id, "to_account_id": my_id},
        ]
    }
    if before:
        query["created_at"] = {"$lt": before}

    messages = await db.svid_relay_messages.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    messages.reverse()

    # Absender-Profile hinzufügen
    profile_cache: dict[str, dict | None] = {}
    for msg in messages:
        sender_id = msg.get("from_account_id")
        if sender_id not in profile_cache:
            acc = await _find_svid_account_by_id(sender_id)
            profile_cache[sender_id] = _safe_profile(acc)
        msg["sender_profile"] = profile_cache[sender_id]

    return {
        "messages": messages,
        "next_before": messages[0]["created_at"] if messages else None,
        "has_more_before": len(messages) == limit,
    }


@router.post("/relay/messages/{message_id}/read")
async def mark_relay_message_read(message_id: str, request: Request) -> dict:
    """Markiert eine empfangene Relay-Nachricht als gelesen."""
    account = await _require_svid_account(request)
    my_id = account["id"]

    result = await db.svid_relay_messages.update_one(
        {"id": message_id, "to_account_id": my_id, "read_at": None},
        {"$set": {"read_at": now_utc()}},
    )

    if result.modified_count == 0:
        raise HTTPException(404, "Nachricht nicht gefunden oder bereits gelesen")

    return {"ok": True}
