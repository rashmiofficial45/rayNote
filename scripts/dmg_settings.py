# -*- coding: utf-8 -*-
import os

# Volume name
volume_name = 'rayNote'

# Volume format (UDZO is standard compressed disk image)
format = 'UDZO'

# Volume icon
icon = 'src-tauri/icons/icon.icns'

# Background image (1640x1080 @ 144 DPI / 2x Retina for 820x540 window)
background = 'src-tauri/icons/dmg-background.png'

# Window position & size: ((x, y), (width, height))
# Center on typical desktop: x=200, y=120, width=820, height=540
window_rect = ((200, 120), (820, 540))

# Default view
default_view = 'icon-view'

# Icon styling
icon_size = 128
text_size = 13

# Clean window - hide toolbar, statusbar, sidebar, pathbar
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

# Files and symlinks
files = [
    'src-tauri/target/release/bundle/macos/rayNote.app'
]

symlinks = {
    'Applications': '/Applications'
}

# Hide file extensions for cleaner look
hide_extensions = [
    'rayNote.app'
]

# Hide background and volume icon from Finder window
hide = [
    '.background.png',
    '.VolumeIcon.icns'
]

# Icon placement inside the 820 x 540 window
# Perfectly aligned with the glowing pedestals in dmg-background.png
icon_locations = {
    'rayNote.app': (210, 365),
    'Applications': (610, 365),
    '.background.png': (3000, 3000),
    '.VolumeIcon.icns': (3000, 3000)
}
