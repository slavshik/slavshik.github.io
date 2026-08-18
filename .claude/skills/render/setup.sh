#!/usr/bin/env bash
# Bootstrap the render skill: creates venv + installs build123d
set -e

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SKILL_DIR/.venv"

# Fast check: marker file means setup already succeeded
if [ -f "$VENV_DIR/.b3d-ready" ]; then
    echo "READY"
    exit 0
fi

# Slower fallback: venv exists but no marker (e.g. partial install)
if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python3" ]; then
    if "$VENV_DIR/bin/python3" -c "import build123d" 2>/dev/null; then
        touch "$VENV_DIR/.b3d-ready"
        echo "READY"
        exit 0
    fi
fi

# build123d needs Python 3.10+ and OCP only ships wheels up to 3.13, while
# macOS still ships 3.9 as `python3` — so pick the interpreter explicitly
# instead of trusting whatever `python3` happens to be.
PYTHON=""
for candidate in python3.12 python3.11 python3.13 python3.10 python3; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info < (3,14) else 1)' 2>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "NO_PYTHON: need Python 3.10-3.13 (brew install python@3.12)" >&2
    exit 1
fi

echo "Setting up render skill with $($PYTHON --version)..."
"$PYTHON" -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet build123d
touch "$VENV_DIR/.b3d-ready"
echo "READY"
