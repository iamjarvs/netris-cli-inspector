#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

./.venv/bin/pip install --quiet -r requirements.txt

if [ ! -f config.json ]; then
  echo "No config.json found. Copy config.example.json to config.json and fill in your Netris password."
  exit 1
fi

exec ./.venv/bin/python main.py
