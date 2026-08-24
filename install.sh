#!/usr/bin/env bash
# Cadara terminal installer (macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/pulakit001/cadara-text-to-cad/main/install.sh | bash
#
# Detects your architecture, downloads the latest Cadara release from
# GitHub and installs it into /Applications. Set DRY_RUN=1 to only show
# what would be done.
set -euo pipefail

REPO="pulakit001/cadara-text-to-cad"
APP_NAME="Cadara"

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# --- platform detection -------------------------------------------------
case "$(uname -s)" in
  Darwin) ;;
  Linux) fail "Linux is not supported yet. macOS: run this on a Mac; Windows: see install.ps1." ;;
  MINGW*|MSYS*|CYGWIN*) fail "On Windows, run this instead: irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex" ;;
  *) fail "Unsupported OS: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ASSET_ARCH="arm64" ;;
  x86_64) ASSET_ARCH="x64" ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac

# --- resolve the latest release asset ------------------------------------
log "Fetching the latest ${APP_NAME} release for mac-${ASSET_ARCH}..."
ASSET_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | cut -d '"' -f4 \
  | grep -- "-mac-${ASSET_ARCH}.dmg" \
  | head -1 || true)
[ -n "$ASSET_URL" ] || fail "No ${APP_NAME}-mac-${ASSET_ARCH}.dmg asset found in the latest release."

if [ "${DRY_RUN:-0}" = "1" ]; then
  log "DRY_RUN: would download ${ASSET_URL}"
  log "DRY_RUN: would install the mounted ${APP_NAME}.app to /Applications/${APP_NAME}.app"
  exit 0
fi

# --- download -------------------------------------------------------------
TMP_DMG="$(mktemp -t cadara.XXXXXX).dmg"
log "Downloading ${ASSET_URL##*/} ..."
curl -fL --progress-bar --retry 3 --retry-delay 3 "$ASSET_URL" -o "$TMP_DMG"

# --- install ----------------------------------------------------------------
log "Mounting disk image..."
MOUNT_DIR=$(hdiutil attach -nobrowse "$TMP_DMG" | grep -o '/Volumes/.*' | head -1)
[ -n "$MOUNT_DIR" ] || { rm -f "$TMP_DMG"; fail "Could not mount the disk image."; }

SRC_APP=$(find "$MOUNT_DIR" -maxdepth 1 -name "${APP_NAME}.app" -print -quit 2>/dev/null)
if [ -z "$SRC_APP" ]; then
  hdiutil detach "$MOUNT_DIR" -quiet || true
  rm -f "$TMP_DMG"
  fail "${APP_NAME}.app not found in the disk image."
fi

log "Installing to /Applications ..."
rm -rf "/Applications/${APP_NAME}.app"
cp -R "$SRC_APP" /Applications/
hdiutil detach "$MOUNT_DIR" -quiet || true
rm -f "$TMP_DMG"

log "${APP_NAME} installed! Launch it from Applications, or run: open -a ${APP_NAME}"
