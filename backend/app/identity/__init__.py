# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox ID – Central Identity Module
========================================

This module implements the Singra Vox ID server, a federated identity provider
that allows users to maintain ONE account across multiple self-hosted Singra Vox
instances.

Architecture:
    - Standalone module with its own database collections (prefixed svid_)
    - Implements OAuth2/OpenID Connect for instance authentication
    - TOTP-based Two-Factor Authentication
    - Can be deployed as part of an instance or as a separate service

Collections:
    svid_accounts     – Central user accounts (email, password, profile)
    svid_sessions     – Login sessions for the ID server
    svid_totp         – 2FA TOTP secrets and backup codes
    svid_oauth_clients – Registered OAuth2 clients (instances)
    svid_oauth_codes  – Short-lived OAuth2 authorization codes
    svid_user_instances – Which instances a user has connected to
"""
