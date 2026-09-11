#!/bin/sh
# Build the actual RevenueCat SDK, UI, and resources for the selected Apple platform.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
platform=${1:-macos}
case "$platform" in
 macos)
   swift build --package-path "$repo/native/apple" --product AudeeoNative -c release
   exit 0 ;;
 ios) destination='generic/platform=iOS'; sdk=iphoneos ;;
 ios-simulator) destination='generic/platform=iOS Simulator'; sdk=iphonesimulator ;;
 *) echo 'Usage: sh scripts/apple-native-build.sh macos|ios|ios-simulator' >&2; exit 1 ;;
esac
cd "$repo/native/apple"
# Xcode invokes this from an app build: do not inherit app-only build settings
# such as ASSETCATALOG_COMPILER_APPICON_NAME into RevenueCat's resource bundles.
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}" \
  /usr/bin/xcodebuild -scheme AudeeoNative -destination "$destination" -sdk "$sdk" \
  -derivedDataPath "$repo/native/apple/.build/$platform" -configuration Release \
  CODE_SIGNING_ALLOWED=NO build
products="$repo/native/apple/.build/$platform/Build/Products/Release-$sdk"
# Xcode emits relocatable objects for standalone Swift package targets.
# Include the transitive SDK objects in the archive consumed by Rust.
xcrun libtool -static -o "$products/libAudeeoNative.a" \
  "$products/AudeeoNative.o" "$products/RevenueCat.o" "$products/RevenueCatUI.o"
test -f "$products/libAudeeoNative.a"
test -d "$products/RevenueCat_RevenueCat.bundle"
test -d "$products/RevenueCat_RevenueCatUI.bundle"
echo "Native archive: $products/libAudeeoNative.a"
