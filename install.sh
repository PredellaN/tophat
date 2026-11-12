#!/usr/bin/env bash
set -euo pipefail

# TopHat extension installation script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure ~/.local/bin is in PATH if present
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "==> TopHat Extension Installer"

# 1. Check GNOME Shell version
if command -v gnome-shell >/dev/null 2>&1; then
  GNOME_VER=$(gnome-shell --version)
  echo "==> Detected $GNOME_VER"
else
  echo "==> Warning: gnome-shell command not found in PATH."
fi

# 2. Check Node.js and Yarn
if ! command -v node >/dev/null 2>&1; then
  echo "==> Error: Node.js is required to build TopHat. Please install Node.js." >&2
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "==> Enabling Yarn via Corepack..."
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable
  else
    echo "==> Error: Yarn is required to build TopHat. Please install Yarn." >&2
    exit 1
  fi
fi

# 3. Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "==> Installing build dependencies with Yarn..."
  yarn install
fi

# 4. Build extension
echo "==> Building TopHat..."
yarn build

# 5. Package extension
echo "==> Packaging TopHat extension bundle..."
./resources/package.sh

VERSION=$(grep "\"version\":" ./resources/metadata.json | awk '{ print $2 }' | sed -e 's/,$//' -e 's/^"//' -e 's/"$//')
UUID=$(grep "\"uuid\":" ./resources/metadata.json | awk '{ print $2 }' | sed -e 's/,$//' -e 's/^"//' -e 's/"$//')
ZIP_FILE="${UUID}.v${VERSION}.shell-extension.zip"

if [ ! -f "$ZIP_FILE" ]; then
  echo "==> Error: Expected package file $ZIP_FILE was not created." >&2
  exit 1
fi

# 6. Install extension
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/${UUID}"
echo "==> Installing extension to $EXTENSION_DIR..."

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions install --force "$ZIP_FILE"
else
  mkdir -p "$EXTENSION_DIR"
  unzip -o -q "$ZIP_FILE" -d "$EXTENSION_DIR"
fi

# Ensure schemas are compiled in the destination directory
if [ -d "$EXTENSION_DIR/schemas" ] && command -v glib-compile-schemas >/dev/null 2>&1; then
  glib-compile-schemas "$EXTENSION_DIR/schemas"
fi

# 7. Enable extension
echo "==> Enabling extension ${UUID}..."
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" 2>/dev/null || true
fi

# Also ensure it is registered in org.gnome.shell enabled-extensions
if command -v gsettings >/dev/null 2>&1; then
  CURRENT_EXTENSIONS=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
  if [[ "$CURRENT_EXTENSIONS" != *"$UUID"* ]]; then
    python3 -c "
import subprocess, ast
try:
    val = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions']).decode().strip()
    exts = ast.literal_eval(val)
    if '$UUID' not in exts:
        exts.append('$UUID')
        subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', str(exts)])
except Exception as e:
    pass
"
  fi
fi

# Try triggering GNOME Shell to reload extensions via DBus
if command -v gdbus >/dev/null 2>&1; then
  gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.CheckForUpdates >/dev/null 2>&1 || true
  gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.ReloadExtension "s" "$UUID" >/dev/null 2>&1 || true
fi

echo "==> TopHat v${VERSION} successfully installed!"
echo "    Note: If TopHat does not immediately appear in the top bar (e.g. under Wayland),"
echo "    please log out and log back in to your GNOME session."
