#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_ARG=""
DEBUG_FLAG=""
PROFILE="release"
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_ARG="$2"
      shift 2
      ;;
    --debug)
      DEBUG_FLAG="--debug"
      PROFILE="debug"
      shift
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

# 2. Select exactly the requested build. Never splice executables into a bundle.
TARGET_ROOT="${CARGO_TARGET_DIR:-${ROOT_DIR}/src-tauri/target}"
if [[ -n "${TARGET_ARG}" ]]; then
  BUNDLE_DIR="${TARGET_ROOT}/${TARGET_ARG}/${PROFILE}"
else
  BUNDLE_DIR="${TARGET_ROOT}/${PROFILE}"
fi
RELEASE_DIR="${BUNDLE_DIR}"
APP_SRC="${BUNDLE_DIR}/bundle/macos/rayNote.app"
if [[ ! -d "${APP_SRC}" ]]; then
  echo "📦 Requested app bundle not found. Building it with Tauri..."
  BUILD_CMD=(pnpm exec tauri build)
  [[ -n "${TARGET_ARG}" ]] && BUILD_CMD+=(--target "${TARGET_ARG}")
  [[ -n "${DEBUG_FLAG}" ]] && BUILD_CMD+=("${DEBUG_FLAG}")
  BUILD_CMD+=(--bundles app)
  "${BUILD_CMD[@]}"
fi
if [[ ! -d "${APP_SRC}" ]]; then
  echo "❌ Requested bundle does not exist: ${APP_SRC}"
  exit 1
fi
echo "📦 Bundling application: ${APP_SRC}"
export RAYNOTE_APP_PATH="${APP_SRC}"

# 3. Ensure dmgbuild is available
if ! command -v dmgbuild &> /dev/null; then
  echo "📥 Installing dmgbuild..."
  pip3 install dmgbuild --break-system-packages -q
fi

# 4. Derive output identity from the version and selected architecture.
APP_VERSION="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "${ROOT_DIR}/src-tauri/tauri.conf.json")"
BUILD_TARGET="${TARGET_ARG}"
if [[ -z "${BUILD_TARGET}" ]]; then
  BUILD_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
fi
BUILD_ARCH="${BUILD_TARGET%%-apple-*}"
DMG_NAME="rayNote_${APP_VERSION}_${BUILD_ARCH}.dmg"
DMG_RELEASE_DIR="${RELEASE_DIR}/bundle/dmg"
PRIMARY_DMG="${DMG_RELEASE_DIR}/${DMG_NAME}"
mkdir -p "${DMG_RELEASE_DIR}"
rm -f "${PRIMARY_DMG}"

# Only detach the exact installer volume; do not force-unmount matching user volumes.
hdiutil detach "/Volumes/rayNote" 2>/dev/null || true

# 5. Build DMG using dmgbuild
echo "💿 Building stylized DMG with native layout (dmgbuild)..."
cd "${ROOT_DIR}"
dmgbuild -s "${SCRIPT_DIR}/dmg_settings.py" "rayNote" "${PRIMARY_DMG}" 2> >(grep -v "hdiutil: WARNING:" >&2)

FINAL_SIZE=$(du -h "${PRIMARY_DMG}" | awk '{print $1}')
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Successfully generated rayNote DMG!"
echo "  📦 Output: ${PRIMARY_DMG} (${FINAL_SIZE})"
echo "══════════════════════════════════════════════════════════"

# 6. Copy to Desktop
if [[ -d "$HOME/Desktop" ]]; then
  echo "📋 Copying installer to Desktop..."
  cp -f "${PRIMARY_DMG}" "$HOME/Desktop/${DMG_NAME}"
  echo "  🖥️  Available at: $HOME/Desktop/${DMG_NAME}"
fi

# 7. Update /Applications/rayNote.app if accessible
if [[ -d "/Applications" && -w "/Applications" ]]; then
  echo "🔄 Updating local /Applications/rayNote.app with freshly built bundle..."
  rm -rf "/Applications/rayNote.app"
  cp -R "${APP_SRC}" "/Applications/rayNote.app"
  echo "  ✨ /Applications/rayNote.app updated."
fi
