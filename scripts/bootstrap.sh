#!/usr/bin/env bash
# bootstrap.sh — Install the Model Alpha CLI to ~/.local/bin.
#
# Run once after loading this skill:
#   bash scripts/bootstrap.sh
#
# This will:
#   1. Symlink scripts/model_alpha_cli.py to ~/.local/bin/model_alpha_cli
#   2. Print next-step commands
#
# No credentials are stored by this installer. Auth is the endpoint's job.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SRC="${SCRIPT_DIR}/model_alpha_cli.py"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_TARGET="${INSTALL_DIR}/model_alpha_cli"

if [ ! -f "$CLI_SRC" ]; then
    echo "ERROR: $CLI_SRC not found"
    exit 1
fi

mkdir -p "$INSTALL_DIR"

if [ ! -L "$INSTALL_TARGET" ] && [ ! -f "$INSTALL_TARGET" ]; then
    ln -s "$CLI_SRC" "$INSTALL_TARGET"
    chmod +x "$INSTALL_TARGET"
    echo "✓ installed: $INSTALL_TARGET -> $CLI_SRC"
else
    rm -f "$INSTALL_TARGET"
    ln -s "$CLI_SRC" "$INSTALL_TARGET"
    echo "✓ refreshed: $INSTALL_TARGET"
fi

if ! command -v model_alpha_cli >/dev/null 2>&1; then
    echo
    echo "WARNING: ~/.local/bin is not on PATH. Add this to ~/.bashrc:"
    echo '  export PATH="$HOME/.local/bin:$PATH"'
fi

echo
echo "Try it:"
echo "  model_alpha_cli --help"
echo "  model_alpha_cli health"
echo "  model_alpha_cli audit-limits"
echo "  model_alpha_cli audit-functions --contract ./Contract.sol"
echo
echo "No configuration needed — the CLI ships with a built-in default endpoint."
echo "Override via MODEL_ALPHA_URL or --url to use your own deployment."
