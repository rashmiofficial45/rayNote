#!/usr/bin/env bash
set -e

rm -rf /tmp/test_rw.dmg /tmp/test_stage
mkdir -p /tmp/test_stage/.background
cp src-tauri/icons/dmg-background.png /tmp/test_stage/.background/
cp -R src-tauri/target/release/bundle/macos/rayNote.app /tmp/test_stage/
ln -s /Applications /tmp/test_stage/Applications

hdiutil create -srcfolder /tmp/test_stage -volname "test_rw" -fs HFS+ -format UDRW -size 60m /tmp/test_rw.dmg -quiet
hdiutil attach -readwrite -noautoopen /tmp/test_rw.dmg

echo "Attached test_rw. Running AppleScript..."
osascript << 'APPLESCRIPT'
tell application "Finder"
  set bgFile to file "test_rw:.background:dmg-background.png"
  set d to disk "test_rw"
  open d
  delay 1.5
  set w to container window of d
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
  set background picture of opts to bgFile
  
  set position of item "rayNote.app" of d to {210, 365}
  set position of item "Applications" of d to {610, 365}
  try
    set position of folder ".background" of d to {3000, 3000}
  end try
  close w
  delay 2
  open d
  delay 1.5
  tell container window of d to close
  delay 2
end tell
APPLESCRIPT

echo "Checking if .DS_Store was written..."
ls -la /Volumes/test_rw/.DS_Store
echo "Ejecting..."
hdiutil detach /Volumes/test_rw
