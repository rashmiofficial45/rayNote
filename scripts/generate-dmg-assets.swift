import Cocoa

// Window dimensions in points (Logical points for Finder)
let windowWidthPoints: CGFloat = 820
let windowHeightPoints: CGFloat = 540
let scale: CGFloat = 2.0 // Retina 2x

let pixelWidth = Int(windowWidthPoints * scale)
let pixelHeight = Int(windowHeightPoints * scale)

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
guard let context = CGContext(
    data: nil,
    width: pixelWidth,
    height: pixelHeight,
    bitsPerComponent: 8,
    bytesPerRow: pixelWidth * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fatalError("Could not create CGContext")
}

let nsContext = NSGraphicsContext(cgContext: context, flipped: false)
NSGraphicsContext.current = nsContext

// Scale context so drawing can use logical points (820 x 540)
context.scaleBy(x: scale, y: scale)

// In non-flipped Cocoa, y=0 is bottom and y=540 is top.
func pt(_ x: CGFloat, _ yFromTop: CGFloat) -> CGPoint {
    return CGPoint(x: x, y: windowHeightPoints - yFromTop)
}

func rectFromTop(_ x: CGFloat, _ yFromTop: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
    return CGRect(x: x, y: windowHeightPoints - yFromTop - h, width: w, height: h)
}

// ── 1. BASE BACKGROUND GRADIENT ──
let bgGradColors = [
    NSColor(red: 0.05, green: 0.06, blue: 0.09, alpha: 1.0).cgColor,
    NSColor(red: 0.08, green: 0.09, blue: 0.14, alpha: 1.0).cgColor,
    NSColor(red: 0.04, green: 0.05, blue: 0.08, alpha: 1.0).cgColor
] as CFArray
let bgLocations: [CGFloat] = [0.0, 0.45, 1.0]
if let bgGradient = CGGradient(colorsSpace: colorSpace, colors: bgGradColors, locations: bgLocations) {
    context.drawLinearGradient(
        bgGradient,
        start: CGPoint(x: 410, y: windowHeightPoints),
        end: CGPoint(x: 410, y: 0),
        options: []
    )
}

// ── 2. AMBIENT RADIAL GLOWS ──
// Top center purple glow (rayNote brand glow)
let purpleGlowColors = [
    NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.30).cgColor,
    NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.08).cgColor,
    NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.0).cgColor
] as CFArray
if let purpleGlow = CGGradient(colorsSpace: colorSpace, colors: purpleGlowColors, locations: [0.0, 0.5, 1.0]) {
    context.drawRadialGradient(
        purpleGlow,
        startCenter: pt(410, 110),
        startRadius: 0,
        endCenter: pt(410, 110),
        endRadius: 400,
        options: []
    )
}

// ── 3. LOAD APP ICON IF AVAILABLE ──
let iconPath = "app-icon.png"
let appIconImage = NSImage(contentsOfFile: iconPath)

// ── 4. HEADER BRANDING ──
let headerY: CGFloat = 22

if let icon = appIconImage {
    let iconRect = rectFromTop(235, headerY - 2, 38, 38)
    // Icon glow
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -2), blur: 10, color: NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.6).cgColor)
    let clipPath = NSBezierPath(roundedRect: iconRect, xRadius: 9, yRadius: 9)
    clipPath.addClip()
    icon.draw(in: iconRect)
    context.restoreGState()

    // 1px border around icon
    NSColor(white: 1.0, alpha: 0.25).setStroke()
    let borderPath = NSBezierPath(roundedRect: iconRect, xRadius: 9, yRadius: 9)
    borderPath.lineWidth = 1.0
    borderPath.stroke()
}

// "rayNote" Title
let titleFont = NSFont.systemFont(ofSize: 26, weight: .bold)
let titleAttrs: [NSAttributedString.Key: Any] = [
    .font: titleFont,
    .foregroundColor: NSColor.white
]
("rayNote" as NSString).draw(at: pt(284, headerY + 28), withAttributes: titleAttrs)

// Subtitle
let subtitleFont = NSFont.systemFont(ofSize: 12.5, weight: .medium)
let subtitleAttrs: [NSAttributedString.Key: Any] = [
    .font: subtitleFont,
    .foregroundColor: NSColor(red: 0.65, green: 0.68, blue: 0.78, alpha: 1.0)
]
let subStr = "Lightning-Fast Floating Markdown Notes"
(subStr as NSString).draw(at: pt(394, headerY + 26), withAttributes: subtitleAttrs)

// Shortcut pill badge: "⌥ Space"
let badgeRect = rectFromTop(656, headerY + 2, 88, 24)
let badgePath = NSBezierPath(roundedRect: badgeRect, xRadius: 12, yRadius: 12)
NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.22).setFill()
badgePath.fill()
NSColor(red: 0.50, green: 0.44, blue: 0.95, alpha: 0.45).setStroke()
badgePath.lineWidth = 1.0
badgePath.stroke()

let badgeAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold),
    .foregroundColor: NSColor(red: 0.82, green: 0.78, blue: 1.0, alpha: 1.0)
]
("⌥ Space" as NSString).draw(at: pt(675, headerY + 19), withAttributes: badgeAttrs)

// ── 5. THE APP PREVIEW WINDOW (SHOW THE APP!) ──
let cardW: CGFloat = 660
let cardH: CGFloat = 175
let cardX: CGFloat = (windowWidthPoints - cardW) / 2.0 // 80
let cardY: CGFloat = 66

let cardRect = rectFromTop(cardX, cardY, cardW, cardH)

// Outer shadow for mockup
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor(red: 0.0, green: 0.0, blue: 0.0, alpha: 0.65).cgColor)

// Card background
let cardPath = NSBezierPath(roundedRect: cardRect, xRadius: 14, yRadius: 14)
NSColor(red: 0.09, green: 0.10, blue: 0.14, alpha: 0.94).setFill()
cardPath.fill()
context.restoreGState()

// Card glass border
NSColor(white: 1.0, alpha: 0.14).setStroke()
cardPath.lineWidth = 1.0
cardPath.stroke()

// Window Top Bar
let topBarH: CGFloat = 34
let topBarRect = rectFromTop(cardX, cardY, cardW, topBarH)
let topBarPath = NSBezierPath(roundedRect: cardRect, xRadius: 14, yRadius: 14)
context.saveGState()
topBarPath.addClip()
NSColor(red: 0.12, green: 0.13, blue: 0.18, alpha: 0.98).setFill()
NSBezierPath(rect: topBarRect).fill()

// Separator line under top bar
NSColor(white: 1.0, alpha: 0.08).setStroke()
let sepLine = NSBezierPath()
sepLine.move(to: pt(cardX, cardY + topBarH))
sepLine.line(to: pt(cardX + cardW, cardY + topBarH))
sepLine.lineWidth = 1.0
sepLine.stroke()
context.restoreGState()

// Traffic Light Dots
func drawDot(_ x: CGFloat, _ color: NSColor) {
    let dotRect = rectFromTop(x, cardY + 11, 11, 11)
    let dot = NSBezierPath(ovalIn: dotRect)
    color.setFill()
    dot.fill()
}
drawDot(cardX + 16, NSColor(red: 1.0, green: 0.37, blue: 0.34, alpha: 1.0)) // Red
drawDot(cardX + 34, NSColor(red: 1.0, green: 0.74, blue: 0.18, alpha: 1.0)) // Yellow
drawDot(cardX + 52, NSColor(red: 0.15, green: 0.79, blue: 0.25, alpha: 1.0)) // Green

// Active note title in top bar
let noteTitleAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
    .foregroundColor: NSColor(white: 0.92, alpha: 1.0)
]
("⚡ Quick Notes & Scratchpad" as NSString).draw(at: pt(cardX + 80, cardY + 23), withAttributes: noteTitleAttrs)

// Tag in top bar
let tagRect = rectFromTop(cardX + cardW - 130, cardY + 7, 72, 20)
let tagPath = NSBezierPath(roundedRect: tagRect, xRadius: 5, yRadius: 5)
NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.20).setFill()
tagPath.fill()
let tagAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 10.5, weight: .medium),
    .foregroundColor: NSColor(red: 0.75, green: 0.70, blue: 1.0, alpha: 1.0)
]
("#macOS-app" as NSString).draw(at: pt(cardX + cardW - 124, cardY + 22), withAttributes: tagAttrs)

// Status pill
let statusPillRect = rectFromTop(cardX + cardW - 48, cardY + 7, 36, 20)
let statusPill = NSBezierPath(roundedRect: statusPillRect, xRadius: 5, yRadius: 5)
NSColor(red: 0.10, green: 0.74, blue: 0.40, alpha: 0.16).setFill()
statusPill.fill()
let statusAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 10, weight: .bold),
    .foregroundColor: NSColor(red: 0.30, green: 0.90, blue: 0.50, alpha: 1.0)
]
("LIVE" as NSString).draw(at: pt(cardX + cardW - 43, cardY + 22), withAttributes: statusAttrs)

// Note Content Lines (Realistic formatted Markdown inside TipTap editor)
let bodyFont = NSFont.systemFont(ofSize: 12.5, weight: .regular)
let headingFont = NSFont.systemFont(ofSize: 14, weight: .bold)
let codeFont = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)

// Heading: "## Raycast-Inspired Floating Scratchpad"
let h2Attrs: [NSAttributedString.Key: Any] = [
    .font: headingFont,
    .foregroundColor: NSColor(red: 0.98, green: 0.98, blue: 1.0, alpha: 1.0)
]
("## Raycast-Inspired Floating Scratchpad" as NSString).draw(at: pt(cardX + 22, cardY + 60), withAttributes: h2Attrs)

// Checkbox items
func drawCheckbox(checked: Bool, text: String, y: CGFloat) {
    let cbRect = rectFromTop(cardX + 22, y - 11, 14, 14)
    let cbPath = NSBezierPath(roundedRect: cbRect, xRadius: 3.5, yRadius: 3.5)
    if checked {
        NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 1.0).setFill()
        cbPath.fill()
        // White checkmark
        let check = NSBezierPath()
        check.move(to: pt(cardX + 25, y - 4))
        check.line(to: pt(cardX + 28, y - 1))
        check.line(to: pt(cardX + 33, y - 8))
        NSColor.white.setStroke()
        check.lineWidth = 1.6
        check.stroke()
    } else {
        NSColor(white: 0.3, alpha: 0.5).setFill()
        cbPath.fill()
        NSColor(white: 0.5, alpha: 0.6).setStroke()
        cbPath.lineWidth = 1.0
        cbPath.stroke()
    }
    
    let textAttrs: [NSAttributedString.Key: Any] = [
        .font: bodyFont,
        .foregroundColor: checked ? NSColor(white: 0.88, alpha: 1.0) : NSColor(white: 0.60, alpha: 1.0)
    ]
    (text as NSString).draw(at: pt(cardX + 44, y), withAttributes: textAttrs)
}

drawCheckbox(checked: true, text: "Always-on-top NSPanel floating above fullscreen spaces", y: cardY + 86)
drawCheckbox(checked: true, text: "Sub-millisecond SQLite FTS5 search & instantaneous autosave", y: cardY + 110)
drawCheckbox(checked: true, text: "TipTap v3 rich Markdown, Slash commands & native hotkeys", y: cardY + 134)

// Code preview box on the right inside mockup
let codeBoxRect = rectFromTop(cardX + cardW - 210, cardY + 48, 195, 112)
let codeBoxPath = NSBezierPath(roundedRect: codeBoxRect, xRadius: 8, yRadius: 8)
NSColor(red: 0.06, green: 0.07, blue: 0.10, alpha: 0.9).setFill()
codeBoxPath.fill()
NSColor(white: 1.0, alpha: 0.08).setStroke()
codeBoxPath.lineWidth = 1.0
codeBoxPath.stroke()

let codeHeaderAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 9.5, weight: .bold),
    .foregroundColor: NSColor(red: 0.55, green: 0.60, blue: 0.75, alpha: 1.0)
]
("// config.rs" as NSString).draw(at: pt(cardX + cardW - 200, cardY + 64), withAttributes: codeHeaderAttrs)

let codeAttrs1: [NSAttributedString.Key: Any] = [
    .font: codeFont,
    .foregroundColor: NSColor(red: 0.90, green: 0.55, blue: 0.70, alpha: 1.0)
]
("let app = rayNote::init();" as NSString).draw(at: pt(cardX + cardW - 200, cardY + 84), withAttributes: codeAttrs1)

let codeAttrs2: [NSAttributedString.Key: Any] = [
    .font: codeFont,
    .foregroundColor: NSColor(red: 0.55, green: 0.85, blue: 0.95, alpha: 1.0)
]
("app.set_hotkey(\"⌥Space\");" as NSString).draw(at: pt(cardX + cardW - 200, cardY + 104), withAttributes: codeAttrs2)

let codeAttrs3: [NSAttributedString.Key: Any] = [
    .font: codeFont,
    .foregroundColor: NSColor(red: 0.55, green: 0.90, blue: 0.60, alpha: 1.0)
]
("app.float_on_top();" as NSString).draw(at: pt(cardX + cardW - 200, cardY + 124), withAttributes: codeAttrs3)

let codeAttrs4: [NSAttributedString.Key: Any] = [
    .font: codeFont,
    .foregroundColor: NSColor(white: 0.50, alpha: 1.0)
]
("// ready in ~42MB" as NSString).draw(at: pt(cardX + cardW - 200, cardY + 144), withAttributes: codeAttrs4)


// ── 6. DRAG AND DROP INSTALLATION ZONE ──
// Target Pedestals:
// Left: rayNote.app icon center at x=210, y=365 (from top)
// Right: Applications folder center at x=610, y=365 (from top)
let appCenterX: CGFloat = 210
let appCenterY: CGFloat = 365
let appFolderCenterX: CGFloat = 610
let appFolderCenterY: CGFloat = 365

let pedestalSize: CGFloat = 160

func drawPedestal(centerX: CGFloat, centerY: CGFloat, isApp: Bool) {
    let pRect = rectFromTop(centerX - pedestalSize/2, centerY - pedestalSize/2, pedestalSize, pedestalSize)
    
    // Outer soft glow
    context.saveGState()
    let glowColor = isApp ?
        NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.32).cgColor :
        NSColor(red: 0.20, green: 0.55, blue: 0.95, alpha: 0.28).cgColor
    context.setShadow(offset: CGSize(width: 0, height: -4), blur: 20, color: glowColor)
    
    let path = NSBezierPath(roundedRect: pRect, xRadius: 28, yRadius: 28)
    NSColor(red: 0.10, green: 0.11, blue: 0.16, alpha: 0.65).setFill()
    path.fill()
    context.restoreGState()
    
    // Frosted glass border
    let strokeColor = isApp ?
        NSColor(red: 0.45, green: 0.40, blue: 0.95, alpha: 0.45) :
        NSColor(red: 0.30, green: 0.60, blue: 1.0, alpha: 0.40)
    strokeColor.setStroke()
    path.lineWidth = 1.5
    path.stroke()

    // Inner dashed guide ring
    let innerRect = rectFromTop(centerX - 68, centerY - 68, 136, 136)
    let innerPath = NSBezierPath(roundedRect: innerRect, xRadius: 22, yRadius: 22)
    let pattern: [CGFloat] = [4.0, 4.0]
    innerPath.setLineDash(pattern, count: 2, phase: 0.0)
    innerPath.lineWidth = 1.0
    NSColor(white: 1.0, alpha: 0.14).setStroke()
    innerPath.stroke()
}

drawPedestal(centerX: appCenterX, centerY: appCenterY, isApp: true)
drawPedestal(centerX: appFolderCenterX, centerY: appFolderCenterY, isApp: false)

// ── 7. DRAG-AND-DROP ARROW & INSTRUCTION BADGE ──
// Beautiful gradient curved arrow from left pedestal to right pedestal
let arrowStartX: CGFloat = appCenterX + pedestalSize/2 + 10 // 210 + 80 + 10 = 300
let arrowEndX: CGFloat = appFolderCenterX - pedestalSize/2 - 10 // 610 - 80 - 10 = 520
let arrowY: CGFloat = appCenterY - 4

let arrowPath = NSBezierPath()
arrowPath.move(to: pt(arrowStartX, arrowY))
arrowPath.curve(
    to: pt(arrowEndX, arrowY),
    controlPoint1: pt(arrowStartX + 60, arrowY - 26),
    controlPoint2: pt(arrowEndX - 60, arrowY - 26)
)

context.saveGState()
// Glow behind arrow
context.setShadow(offset: CGSize(width: 0, height: -2), blur: 14, color: NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.60).cgColor)
NSColor(red: 0.55, green: 0.48, blue: 0.98, alpha: 0.88).setStroke()
arrowPath.lineWidth = 3.2
arrowPath.stroke()
context.restoreGState()

// Arrow Head
let headPath = NSBezierPath()
headPath.move(to: pt(arrowEndX - 14, arrowY - 10))
headPath.line(to: pt(arrowEndX + 2, arrowY))
headPath.line(to: pt(arrowEndX - 14, arrowY + 10))
NSColor(red: 0.55, green: 0.48, blue: 0.98, alpha: 0.95).setStroke()
headPath.lineWidth = 3.2
headPath.lineCapStyle = .round
headPath.lineJoinStyle = .round
headPath.stroke()

// Floating Instruction Badge in middle of arrow
let midBadgeW: CGFloat = 152
let midBadgeH: CGFloat = 32
let midBadgeRect = rectFromTop(410 - midBadgeW/2, arrowY - 34, midBadgeW, midBadgeH)
let midBadgePath = NSBezierPath(roundedRect: midBadgeRect, xRadius: 16, yRadius: 16)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -4), blur: 16, color: NSColor(red: 0.0, green: 0.0, blue: 0.0, alpha: 0.45).cgColor)
NSColor(red: 0.12, green: 0.13, blue: 0.19, alpha: 0.96).setFill()
midBadgePath.fill()
context.restoreGState()

NSColor(red: 0.42, green: 0.36, blue: 0.91, alpha: 0.65).setStroke()
midBadgePath.lineWidth = 1.2
midBadgePath.stroke()

let midTextAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 11, weight: .bold),
    .foregroundColor: NSColor.white
]
let midStr = "DRAG TO INSTALL  ➔"
let midTextSize = (midStr as NSString).size(withAttributes: midTextAttrs)
(midStr as NSString).draw(at: pt(410 - midTextSize.width/2, arrowY - 34 + 21), withAttributes: midTextAttrs)

// ── 8. FOOTER HINT ──
let footerAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 11, weight: .regular),
    .foregroundColor: NSColor(white: 0.48, alpha: 1.0)
]
let footerStr = "Drag rayNote into Applications • Eject disk image when done • Press ⌥Space to summon"
let footerSize = (footerStr as NSString).size(withAttributes: footerAttrs)
(footerStr as NSString).draw(at: pt(410 - footerSize.width/2, windowHeightPoints - 16), withAttributes: footerAttrs)

// ── 9. EXPORT HIGH-DPI RETINA PNG & TIFF ──
guard let cgImage = context.makeImage() else {
    fatalError("Failed to make CGImage")
}

let rep = NSBitmapImageRep(cgImage: cgImage)
rep.size = NSSize(width: windowWidthPoints, height: windowHeightPoints) // 72pt * scale = 144 DPI logical point sizing

guard let pngData = rep.representation(using: .png, properties: [:]) else {
    fatalError("Failed to convert image to PNG")
}

let outPngPath = "src-tauri/icons/dmg-background.png"
let outPngUrl = URL(fileURLWithPath: outPngPath)
try pngData.write(to: outPngUrl)

// Also write to root of src-tauri
let outPngPath2 = "src-tauri/dmg-background.png"
try pngData.write(to: URL(fileURLWithPath: outPngPath2))

print("Successfully generated high-DPI DMG background:")
print("  Width: \(pixelWidth)px (\(windowWidthPoints)pt)")
print("  Height: \(pixelHeight)px (\(windowHeightPoints)pt)")
print("  Output: \(outPngPath)")
