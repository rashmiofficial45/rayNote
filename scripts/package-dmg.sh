#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "══════════════════════════════════════════════════════════"
echo "  🚀 rayNote — Premium DMG Builder"
echo "══════════════════════════════════════════════════════════"

# 1. Generate high-DPI Retina background image
echo "🎨 Generating high-DPI Retina DMG background (820x540 pt @ 2x)..."
swift "${SCRIPT_DIR}/generate-dmg-assets.swift"

# 2. Check for rayNote.app
APP_SRC="${ROOT_DIR}/src-tauri/target/release/bundle/macos/rayNote.app"
if [[ ! -d "${APP_SRC}" ]]; then
  echo "📦 rayNote.app not found. Building release bundle with Tauri..."
  pnpm tauri build --bundles app
fi

if [[ ! -d "${APP_SRC}" ]]; then
  echo "❌ Error: Could not locate ${APP_SRC}"
  exit 1
fi

# 3. Ensure dmgbuild is available
if ! command -v dmgbuild &> /dev/null; then
  echo "📥 Installing dmgbuild..."
  pip3 install dmgbuild --break-system-packages -q
fi

# 4. Prepare output directory
DMG_OUT_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/dmg"
DMG_OUT_FILE="${DMG_OUT_DIR}/rayNote_0.1.0_aarch64.dmg"
mkdir -p "${DMG_OUT_DIR}"
rm -f "${DMG_OUT_FILE}"

# Unmount any existing volume named rayNote
hdiutil detach "/Volumes/rayNote" 2>/dev/null || true

# 5. Build DMG using dmgbuild
echo "💿 Building stylized DMG with native layout..."
cd "${ROOT_DIR}"
dmgbuild -s "${SCRIPT_DIR}/dmg_settings.py" "rayNote" "${DMG_OUT_FILE}"

FINAL_SIZE=$(du -h "${DMG_OUT_FILE}" | awk '{print $1}')
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Successfully generated rayNote DMG!"
echo "  📦 Output: ${DMG_OUT_FILE} (${FINAL_SIZE})"
echo "══════════════════════════════════════════════════════════"

# 6. Automatically copy to Desktop
DMG_PATH="${DMG_OUT_FILE}"
if [[ -d "$HOME/Desktop" ]]; then
  echo "📋 Copying installer to Desktop..."
  cp "${DMG_PATH}" "$HOME/Desktop/"
  echo "  🖥️  Available at: $HOME/Desktop/$(basename "${DMG_PATH}")"
fi

