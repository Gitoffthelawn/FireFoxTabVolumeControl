#!/bin/bash
# Firefox Tab Volume Control - Simple Release Script
# Creates a release ZIP using native bash commands

echo "Firefox Tab Volume Control - Release Builder"

# Store the project directory
PROJECT_DIR=$(pwd)

# Get version from manifest.json
VERSION=$(grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
ZIP_NAME="tab-volume-control-v${VERSION}-fixed.zip"
ZIP_PATH="$PROJECT_DIR/$ZIP_NAME"

echo "Building version: $VERSION"

# Remove existing ZIP if it exists
if [ -f "$ZIP_PATH" ]; then
    rm -f "$ZIP_PATH"
    echo "Removed existing package"
fi

# Create the release package
echo "Creating release package..."

# Create a temporary directory for staging
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy files to temp directory maintaining structure
cp manifest.json "$TEMP_DIR/"
cp LICENSE.md "$TEMP_DIR/"
cp README.md "$TEMP_DIR/"
cp -r src "$TEMP_DIR/"

# Create ZIP file (zip command uses forward slashes by default)
cd "$TEMP_DIR"
zip -r "$ZIP_PATH" . > /dev/null
cd "$PROJECT_DIR"

# Get package info
if [ -f "$ZIP_PATH" ]; then
    SIZE=$(stat -f%z "$ZIP_PATH" 2>/dev/null || stat -c%s "$ZIP_PATH" 2>/dev/null)
    SIZE_KB=$((SIZE / 1024))
    if [ $SIZE_KB -gt 1024 ]; then
        SIZE_MB=$((SIZE_KB / 1024))
        SIZE_TEXT="${SIZE_MB} MB"
    else
        SIZE_TEXT="${SIZE_KB} KB"
    fi
else
    SIZE_TEXT="unknown"
fi

echo ""
echo "✅ Release package created successfully!"
echo "📦 Package: $ZIP_NAME"
echo "📏 Size: $SIZE_TEXT"
echo "🏷️  Version: $VERSION"
echo ""
echo "Ready for Firefox Add-on submission!"

