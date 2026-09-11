#!/bin/sh
# Xcode post-build phase: bundle SDK assets before signing the iOS app.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "${PLATFORM_NAME:?}" in
 iphoneos) platform=ios ;;
 iphonesimulator) platform=ios-simulator ;;
 *) echo 'Unsupported billing resource platform' >&2; exit 1 ;;
esac
if [ -n "${AUDEEO_NATIVE_ARCHIVE:-}" ]; then
 products=$(dirname -- "$AUDEEO_NATIVE_ARCHIVE")
else
 products="$repo/native/apple/.build/$platform/Build/Products/Release-$PLATFORM_NAME"
fi
for bundle in RevenueCat_RevenueCat.bundle RevenueCat_RevenueCatUI.bundle; do
 test -d "$products/$bundle" || { echo "Missing billing resources: $products/$bundle" >&2; exit 1; }
 /usr/bin/ditto "$products/$bundle" "${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/$bundle"
done
