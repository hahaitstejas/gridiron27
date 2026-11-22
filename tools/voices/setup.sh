#!/bin/bash
# One-time setup for `npm run voices`: a private Python environment (.venv-voice, git-ignored) with Chatterbox.
set -e
PY=$(command -v python3.11 || command -v python3.10 || command -v python3.12 || true)
if [ -z "$PY" ]; then
  echo "Chatterbox needs Python 3.10, 3.11 or 3.12. On a Mac: brew install python@3.11   then run this again."
  exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing. On a Mac: brew install ffmpeg   then run this again."; exit 1; }
echo "Using $PY"
"$PY" -m venv .venv-voice
.venv-voice/bin/python -m pip install --upgrade pip
.venv-voice/bin/python -m pip install chatterbox-tts
echo "Done. Now run: npm run voices"
