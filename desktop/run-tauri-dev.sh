#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.cargo/bin:$PATH"
export LIBGL_ALWAYS_SOFTWARE="1"
export GALLIUM_DRIVER="llvmpipe"
export GSK_RENDERER="cairo"
export WEBKIT_DISABLE_DMABUF_RENDERER="1"
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

cd "$(dirname "$0")"
exec yarn tauri:dev

