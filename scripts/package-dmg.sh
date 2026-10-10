#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_ARG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_ARG="$2"
      shift 2
      ;;
    *)
      if [[ -z "${TARGET_ARG}" && "$1" != -* ]]; then
        TARGET_ARG="$1"
      fi
      shift
      ;;
  esac
done

echo "══════════════════════════════════════════════════════════"
echo "  🚀 rayNote — Premium DMG Builder"
echo "══════════════════════════════════════════════════════════"

# 1. Generate high-DPI Retina background image if missing
BG_IMG="${ROOT_DIR}/src-tauri/icons/dmg-background.png"
if [[ ! -f "${BG_IMG}" ]]; then
  echo "🎨 Generating high-DPI Retina DMG background (820x540 pt @ 2x)..."
  swift "${SCRIPT_DIR}/generate-dmg-assets.swift"
else
  echo "🎨 Using high-DPI Retina DMG background: ${BG_IMG}"
fi

# 2. Locate newest rayNote.app
CANDIDATE_PATHS=()
if [[ -n "${TARGET_ARG}" ]]; then
  CANDIDATE_PATHS+=("${ROOT_DIR}/src-tauri/target/${TARGET_ARG}/release/bundle/macos/rayNote.app")
fi
CANDIDATE_PATHS+=(
  "${ROOT_DIR}/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/rayNote.app"
  "${ROOT_DIR}/src-tauri/target/release/bundle/macos/rayNote.app"
)

APP_SRC=""
for p in "${CANDIDATE_PATHS[@]}"; do
  if [[ -d "$p" ]]; then
    APP_SRC="$p"
    break
  fi
done

if [[ -z "${APP_SRC}" || ! -d "${APP_SRC}" ]]; then
  echo "📦 rayNote.app not found. Building release bundle with Tauri..."
  if [[ -n "${TARGET_ARG}" ]]; then
    pnpm exec tauri build --target "${TARGET_ARG}" --bundles app
  else
    pnpm exec tauri build --bundles app
  fi
  for p in "${CANDIDATE_PATHS[@]}"; do
    if [[ -d "$p" ]]; then
      APP_SRC="$p"
      break
    fi
  done
fi

if [[ -z "${APP_SRC}" || ! -d "${APP_SRC}" ]]; then
  echo "❌ Error: Could not locate rayNote.app"
  exit 1
fi

echo "📦 Bundling application: ${APP_SRC}"
export RAYNOTE_APP_PATH="${APP_SRC}"

# 3. Ensure dmgbuild is available
if ! command -v dmgbuild &> /dev/null; then
  echo "📥 Installing dmgbuild..."
  pip3 install dmgbuild --break-system-packages -q
fi

# 4. Prepare output directories and paths
DMG_RELEASE_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/dmg"
DMG_AARCH_DIR="${ROOT_DIR}/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
PRIMARY_DMG="${DMG_AARCH_DIR}/rayNote_0.1.0_aarch64.dmg"

mkdir -p "${DMG_RELEASE_DIR}" "${DMG_AARCH_DIR}"
rm -f "${PRIMARY_DMG}"

# Unmount any existing volume named rayNote
hdiutil detach "/Volumes/rayNote" 2>/dev/null || true

# 5. Build DMG using dmgbuild
echo "💿 Building stylized DMG with native layout (dmgbuild)..."
cd "${ROOT_DIR}"
dmgbuild -s "${SCRIPT_DIR}/dmg_settings.py" "rayNote" "${PRIMARY_DMG}"

# Duplicate to target/release/bundle/dmg for standard Tauri paths
cp -f "${PRIMARY_DMG}" "${DMG_RELEASE_DIR}/rayNote_0.1.0_aarch64.dmg"

FINAL_SIZE=$(du -h "${PRIMARY_DMG}" | awk '{print $1}')
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Successfully generated rayNote DMG!"
echo "  📦 Output: ${PRIMARY_DMG} (${FINAL_SIZE})"
echo "══════════════════════════════════════════════════════════"

# 6. Copy to Desktop
if [[ -d "$HOME/Desktop" ]]; then
  echo "📋 Copying installer to Desktop..."
  cp -f "${PRIMARY_DMG}" "$HOME/Desktop/rayNote_0.1.0_aarch64.dmg"
  echo "  🖥️  Available at: $HOME/Desktop/rayNote_0.1.0_aarch64.dmg"
fi

# 7. Update /Applications/rayNote.app if accessible
if [[ -d "/Applications" && -w "/Applications" ]]; then
  echo "🔄 Updating local /Applications/rayNote.app with freshly built bundle..."
  rm -rf "/Applications/rayNote.app"
  cp -R "${APP_SRC}" "/Applications/rayNote.app"
  echo "  ✨ /Applications/rayNote.app updated."
fi
