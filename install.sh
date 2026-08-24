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

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    \033[2m%s\033[0m\n' "$*"; }
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

log "Step 1/4 — Detecting platform: macOS ($ASSET_ARCH)"

# --- resolve the latest release asset ------------------------------------
log "Step 2/4 — Looking up the latest ${APP_NAME} release..."
ASSET_URL=""
for attempt in 1 2 3 4 5; do
  ASSET_URL=$(curl -fsSL --max-time 20 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | cut -d '"' -f4 \
    | grep -- "-mac-${ASSET_ARCH}.dmg" \
    | head -1 || true)
  [ -n "$ASSET_URL" ] && break
  info "Lookup attempt $attempt failed (network hiccup?); retrying in 3s..."
  sleep 3
done
[ -n "$ASSET_URL" ] || fail "Could not resolve the latest ${APP_NAME}-mac-${ASSET_ARCH}.dmg. Check your internet connection and try again."
info "Latest release: ${ASSET_URL}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  log "DRY_RUN: would download ${ASSET_URL##*/} (~420 MB) and install it to /Applications/${APP_NAME}.app"
  exit 0
fi

# --- download -------------------------------------------------------------
log "Step 3/4 — Downloading ${ASSET_URL##*/} (large file, ~420 MB — please keep this window open)..."
TMP_DMG="$(mktemp -t cadara.XXXXXX).dmg"
DL_OK=0
for attempt in 1 2 3; do
  # curl's default meter shows percent, speed and ETA; --continue-at - resumes
  # a partial download if the connection drops mid-way.
  if curl -fL --continue-at - --retry 3 --retry-delay 3 --max-time 1800 "$ASSET_URL" -o "$TMP_DMG" \
    && [ "$(stat -f %z "$TMP_DMG" 2>/dev/null || echo 0)" -gt 100000000 ]; then
    DL_OK=1
    break
  fi
  info "Download attempt $attempt failed or file incomplete; resuming in 3s..."
  sleep 3
done
[ "$DL_OK" = "1" ] || { rm -f "$TMP_DMG"; fail "Download failed after 3 attempts. Please try again later."; }

# --- install ----------------------------------------------------------------
log "Step 4/4 — Installing to /Applications ..."
info "Mounting disk image..."
MOUNT_DIR=$(hdiutil attach -nobrowse "$TMP_DMG" | grep -o '/Volumes/.*' | head -1)
[ -n "$MOUNT_DIR" ] || { rm -f "$TMP_DMG"; fail "Could not mount the disk image."; }

SRC_APP=$(find "$MOUNT_DIR" -maxdepth 1 -name "${APP_NAME}.app" -print -quit 2>/dev/null)
if [ -z "$SRC_APP" ]; then
  hdiutil detach "$MOUNT_DIR" -quiet || true
  rm -f "$TMP_DMG"
  fail "${APP_NAME}.app not found in the disk image."
fi

rm -rf "/Applications/${APP_NAME}.app"
cp -R "$SRC_APP" /Applications/
info "Copying ${APP_NAME}.app (~1.4 GB unpacked) — this can take a minute..."
hdiutil detach "$MOUNT_DIR" -quiet || true
rm -f "$TMP_DMG"

log "${APP_NAME} installed successfully! Launch it from Applications, or run: open -a ${APP_NAME}"
