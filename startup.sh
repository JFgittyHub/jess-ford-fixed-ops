#!/bin/sh
# Restart contract for the preview sandbox. A fresh clone uses `npm run dev`
# from the README instead. Paths are relative to this file so the script is
# not tied to one machine layout.
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)" || exit 1
if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
  exit 0
fi
mkdir -p .local
npm run dev > .local/dev-server.log 2>&1 &
exit 0
