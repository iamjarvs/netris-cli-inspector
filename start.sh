#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

./.venv/bin/pip install --quiet -r requirements.txt

if [ ! -f config.json ]; then
  echo "No config.json found. Copying config.example.json to config.json."
  cp config.example.json config.json
fi

PORT="${PORT:-8743}"
echo "Starting CLI Inspector Web Server on http://localhost:${PORT}"
export PYTHONPATH="$(pwd)/app"
exec ./.venv/bin/python app/webserver.py
