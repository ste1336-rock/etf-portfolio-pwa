#!/bin/bash
# 在 macOS 桌面建立「ETF投資追蹤.app」，雙擊用預設瀏覽器開啟 PWA。
# 用 icons/icon-512.png 產生專屬綠色圖示。可重複執行（會覆蓋舊的）。
# 用法：bash scripts/build-mac-app.sh
set -euo pipefail

URL="https://ste1336-rock.github.io/etf-portfolio-pwa/index.html?v=1"
APP_NAME="ETF投資追蹤"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ICON="$REPO_DIR/icons/icon-512.png"
APP="$HOME/Desktop/$APP_NAME.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$SRC_ICON" ] || { echo "找不到 $SRC_ICON"; exit 1; }

# 1) 產生 .icns
ICONSET="$TMP/app.iconset"; mkdir -p "$ICONSET"
for sz in 16 32 64 128 256 512; do
  sips -z "$sz" "$sz" "$SRC_ICON" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  dbl=$((sz * 2))
  sips -z "$dbl" "$dbl" "$SRC_ICON" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$TMP/app.icns"

# 2) 組 .app bundle
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$TMP/app.icns" "$APP/Contents/Resources/app.icns"

cat > "$APP/Contents/MacOS/launcher" <<EOF
#!/bin/bash
open "$URL"
EOF
chmod +x "$APP/Contents/MacOS/launcher"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ETF投資追蹤</string>
  <key>CFBundleDisplayName</key><string>ETF投資追蹤</string>
  <key>CFBundleIdentifier</key><string>com.jerrywu.etfpwa.launcher</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# 3) 讓 Finder 重讀圖示
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$APP" 2>/dev/null || true

echo "✅ 已建立：$APP"
echo "   雙擊即可開啟；首次若被 Gatekeeper 擋，右鍵 →「打開」放行一次。"
