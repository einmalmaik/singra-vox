# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
from __future__ import annotations


DEFAULT_MESSAGE_PAGE_SIZE = 50
MAX_MESSAGE_PAGE_SIZE = 100
INITIAL_MESSAGE_WINDOW_PAGES = 2


def clamp_page_limit(limit: int | None, *, default: int = DEFAULT_MESSAGE_PAGE_SIZE, maximum: int = MAX_MESSAGE_PAGE_SIZE) -> int:
    if limit is None:
        return default
    try:
        parsed_limit = int(limit)
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed_limit, maximum))
