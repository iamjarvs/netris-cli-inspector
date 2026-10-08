#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

./.venv/bin/pip install --quiet -r requirements.txt

if [ ! -f config.json ]; then
  echo "No config.json found. Copy config.example.json to config.json."
  exit 1
fi

PORT="${PORT:-8743}"
echo "Starting CLI Inspector Web Server on http://localhost:${PORT}"
exec ./.venv/bin/python webserver.py
