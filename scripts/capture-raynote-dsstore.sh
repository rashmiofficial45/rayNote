#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOLUME_NAME="rayNote"
TEMP_DMG="/tmp/rayNote_builder.dmg"
STAGE_DIR="/tmp/rayNote_builder_stage"

# Clean up
hdiutil detach "/Volumes/${VOLUME_NAME}" 2>/dev/null || true
rm -rf "${TEMP_DMG}" "${STAGE_DIR}"

mkdir -p "${STAGE_DIR}/.background"
cp "${ROOT_DIR}/src-tauri/icons/dmg-background.png" "${STAGE_DIR}/.background/dmg-background.png"
cp -R "${ROOT_DIR}/src-tauri/target/release/bundle/macos/rayNote.app" "${STAGE_DIR}/rayNote.app"
ln -s /Applications "${STAGE_DIR}/Applications"

if [[ -f "${ROOT_DIR}/src-tauri/icons/icon.icns" ]]; then
  cp "${ROOT_DIR}/src-tauri/icons/icon.icns" "${STAGE_DIR}/.VolumeIcon.icns"
  SetFile -c icnC "${STAGE_DIR}/.VolumeIcon.icns" 2>/dev/null || true
  SetFile -a V "${STAGE_DIR}/.VolumeIcon.icns" 2>/dev/null || true
fi

SetFile -a V "${STAGE_DIR}/.background" 2>/dev/null || true

# Calculate size in MB
SRC_SIZE_KB=$(du -sk "${STAGE_DIR}" | awk '{print $1}')
DMG_SIZE_MB=$(( (SRC_SIZE_KB / 1024) + 40 ))

echo "Creating read-write DMG (${DMG_SIZE_MB}m) with volume '${VOLUME_NAME}'..."
hdiutil create -srcfolder "${STAGE_DIR}" -volname "${VOLUME_NAME}" -fs HFS+ \
  -fsargs "-c c=64,a=16,e=16" -format UDRW -size "${DMG_SIZE_MB}m" "${TEMP_DMG}" -quiet

echo "Attaching ${TEMP_DMG}..."
ATTACH_INFO=$(hdiutil attach -readwrite -noautoopen "${TEMP_DMG}")
DEV_NAME=$(echo "${ATTACH_INFO}" | grep -E '^/dev/' | head -1 | awk '{print $1}')

if [[ -f "/Volumes/${VOLUME_NAME}/.VolumeIcon.icns" ]]; then
  SetFile -a C "/Volumes/${VOLUME_NAME}" 2>/dev/null || true
fi

echo "Running AppleScript for disk '${VOLUME_NAME}'..."
osascript << 'EOF'
tell application "Finder"
  tell disk "rayNote"
    open
    delay 1.5
    set w to container window
    tell w
      set current view to icon view
      set toolbar visible to false
      set statusbar visible to false
      set bounds to {100, 100, 920, 640}
    end tell
    
    set opts to icon view options of w
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 13
    
    set background picture of opts to file ".background:dmg-background.png"
    
    try
      set position of item "rayNote.app" to {210, 365}
    end try
    try
      set position of item "Applications" to {610, 365}
    end try
    try
      set position of item ".background" to {3000, 3000}
    end try
    try
      set position of item ".VolumeIcon.icns" to {3000, 3000}
    end try
    try
      set position of item ".fseventsd" to {3000, 3000}
    end try
    try
      set position of item ".Trashes" to {3000, 3000}
    end try
    
    close w
    delay 2
    open
    delay 1.5
    close container window
    delay 2
  end tell
end tell
EOF

echo "Checking .DS_Store..."
ls -la "/Volumes/${VOLUME_NAME}/.DS_Store"

mkdir -p "${ROOT_DIR}/scripts/assets"
cp "/Volumes/${VOLUME_NAME}/.DS_Store" "${ROOT_DIR}/scripts/assets/dmg_DS_Store"
echo "Saved golden .DS_Store ($(wc -c < "${ROOT_DIR}/scripts/assets/dmg_DS_Store") bytes)"

echo "Detaching volume..."
hdiutil detach "${DEV_NAME}" -quiet || hdiutil detach "/Volumes/${VOLUME_NAME}" -force -quiet
rm -rf "${TEMP_DMG}" "${STAGE_DIR}"
echo "Done!"
