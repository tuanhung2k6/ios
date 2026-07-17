#!/bin/bash
# =============================================================================
# Automated iOS Compilation & Packaging Script (No Xcode project required)
# Runs on macOS (local or Github Actions cloud)
# =============================================================================

set -e

echo "[+] Starting iOS App Compilation..."

# 1. Setup paths
APP_NAME="iControlApp"
OUT_DIR="build_output"
PAYLOAD_DIR="${OUT_DIR}/Payload"
APP_DIR="${PAYLOAD_DIR}/${APP_NAME}.app"

# Clean previous builds
rm -rf "${OUT_DIR}"
mkdir -p "${APP_DIR}"

# 2. Compile Swift files directly into iOS arm64 executable binary
echo "[+] Compiling Swift source files..."
xcrun -sdk iphoneos swiftc \
    -target arm64-apple-ios15.0 \
    -O \
    -o "${APP_DIR}/${APP_NAME}" \
    iControlApp/AppDelegate.swift \
    iControlApp/ViewController.swift \
    iControlApp/FloatingWindow.swift \
    iControlApp/TouchSimulator.swift \
    iControlApp/WebSocketClient.swift

# 3. Copy Assets & Plist
echo "[+] Copying assets and resources..."
if [ -f "iControlApp/Info.plist" ]; then
    cp "iControlApp/Info.plist" "${APP_DIR}/"
else
    # Fallback default Info.plist if not in subfolder
    cp "Info.plist" "${APP_DIR}/"
fi

# Copy HTML editor resource
cp ../web_server_dashboard/public/index.html "${APP_DIR}/editor.html"

# 4. Codesign application with entitlements
echo "[+] Signing binary with custom entitlements..."
codesign -s - --entitlements entitlements.plist --force "${APP_DIR}/${APP_NAME}"

# 5. Pack into .ipa ZIP archive
echo "[+] Creating IPA package..."
cd "${OUT_DIR}"
zip -r "../${APP_NAME}.ipa" Payload
cd ..

echo "[+] Compilation successful! Output generated: ${APP_NAME}.ipa"
