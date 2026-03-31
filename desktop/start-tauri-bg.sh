#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
rm -f /tmp/singra-tauri.pid /tmp/singra-tauri.log
nohup bash ./run-tauri-dev.sh >/tmp/singra-tauri.log 2>&1 </dev/null &
echo $! >/tmp/singra-tauri.pid
sleep 2
cat /tmp/singra-tauri.pid

