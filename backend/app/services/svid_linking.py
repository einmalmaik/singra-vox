"""
Singra Vox - Local <-> Singra-ID account linking helpers
=========================================================

Centralizes the dual-write linking contract between local instance users and
Singra-ID accounts. The local auth stack resolves users via `users.svid_account_id`
while friends/relay features resolve the central account via
`svid_accounts.linked_user_id`. Keeping both references in sync avoids hidden
feature drift between login and cross-instance features.
"""

from __future__ import annotations

from fastapi import HTTPException


def _safe_svid_account(account: dict) -> dict:
    safe = dict(account or {})
    safe.pop("_id", None)
    safe.pop("password_hash", None)
    return safe


async def resolve_linked_svid_account(db, *, local_user: dict) -> dict | None:
    """
    Resolve the Singra-ID account for a local instance user.

    Primary lookup is `users.svid_account_id`, with a fallback to the legacy
    `svid_accounts.linked_user_id` relation so older data can still be read.
    """
    svid_account_id = (local_user or {}).get("svid_account_id")
    if svid_account_id:
        account = await db.svid_accounts.find_one({"id": svid_account_id}, {"_id": 0})
        if account:
            return account

    user_id = (local_user or {}).get("id")
    if not user_id:
        return None

    return await db.svid_accounts.find_one({"linked_user_id": user_id}, {"_id": 0})


async def link_local_user_to_svid(
    db,
    *,
    local_user: dict,
    svid_account: dict,
    svid_issuer: str,
    disable_local_password_login: bool,
) -> tuple[dict, dict]:
    """
    Link an authenticated local user to a Singra-ID account.

    The relation is stored on both sides because different subsystems currently
    resolve the link from different collections.
    """
    local_user_id = (local_user or {}).get("id")
    svid_account_id = (svid_account or {}).get("id")
    if not local_user_id or not svid_account_id:
        raise HTTPException(400, "Invalid local or Singra-ID account")

    current_svid_account_id = (local_user or {}).get("svid_account_id")
    if current_svid_account_id and current_svid_account_id != svid_account_id:
        raise HTTPException(409, "Dieses Instanzkonto ist bereits mit einer anderen Singra-ID verknüpft.")

    existing_legacy_link = await db.svid_accounts.find_one(
        {"linked_user_id": local_user_id, "id": {"$ne": svid_account_id}},
        {"_id": 0, "id": 1},
    )
    if existing_legacy_link:
        raise HTTPException(409, "Dieses Instanzkonto ist bereits mit einer anderen Singra-ID verknüpft.")

    existing_local = await db.users.find_one({"svid_account_id": svid_account_id}, {"_id": 0, "id": 1})
    if existing_local and existing_local.get("id") != local_user_id:
        raise HTTPException(409, "Diese Singra-ID ist bereits mit einem anderen Instanzkonto verknüpft.")

    existing_central = await db.svid_accounts.find_one({"id": svid_account_id}, {"_id": 0, "linked_user_id": 1})
    existing_linked_user_id = (existing_central or {}).get("linked_user_id")
    if existing_linked_user_id and existing_linked_user_id != local_user_id:
        raise HTTPException(409, "Diese Singra-ID ist bereits mit einem anderen Instanzkonto verknüpft.")

    await db.users.update_one(
        {"id": local_user_id},
        {
            "$set": {
                "svid_account_id": svid_account_id,
                "svid_server": svid_issuer,
                "local_login_disabled": bool(disable_local_password_login),
            }
        },
    )
    await db.svid_accounts.update_one(
        {"id": svid_account_id},
        {"$set": {"linked_user_id": local_user_id}},
    )

    updated_local_user = await db.users.find_one({"id": local_user_id}, {"_id": 0})
    updated_svid_account = await db.svid_accounts.find_one({"id": svid_account_id}, {"_id": 0})
    return updated_local_user or dict(local_user), _safe_svid_account(updated_svid_account or svid_account)
