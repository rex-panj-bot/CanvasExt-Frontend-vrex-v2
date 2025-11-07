#!/bin/bash

# Build script for Chrome Web Store package
# This creates a clean ZIP file with only the necessary extension files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
ZIP_NAME="canvas-extension-chrome-store.zip"

echo "🧹 Cleaning previous build..."
rm -rf "$BUILD_DIR"
rm -f "$SCRIPT_DIR/$ZIP_NAME"

echo "📦 Creating build directory..."
mkdir -p "$BUILD_DIR"

echo "📋 Copying extension files..."
# Copy necessary directories
cp -r "$SCRIPT_DIR/background" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/chat" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/content" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/icons" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/lib" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/popup" "$BUILD_DIR/"
cp -r "$SCRIPT_DIR/utils" "$BUILD_DIR/"

# Copy manifest
cp "$SCRIPT_DIR/manifest.json" "$BUILD_DIR/"

echo "🗜️  Creating ZIP archive..."
cd "$BUILD_DIR"
zip -r "../$ZIP_NAME" . -x "*.DS_Store" "*/.*"

cd "$SCRIPT_DIR"

echo "📊 Package info:"
PACKAGE_SIZE=$(du -h "$ZIP_NAME" | cut -f1)
echo "  Size: $PACKAGE_SIZE"
echo "  Location: $SCRIPT_DIR/$ZIP_NAME"

echo ""
echo "✅ Build complete!"
echo ""
echo "📤 To upload to Chrome Web Store:"
echo "   1. Go to https://chrome.google.com/webstore/devconsole"
echo "   2. Upload: $ZIP_NAME"
echo ""

# Calculate uncompressed size
UNCOMPRESSED_SIZE=$(du -sh "$BUILD_DIR" | cut -f1)
echo "Uncompressed size: $UNCOMPRESSED_SIZE"

# Clean up build directory
rm -rf "$BUILD_DIR"