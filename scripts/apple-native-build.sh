#!/bin/sh
# Build the macOS RevenueCat SDK and native audio/window bridges.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "${1:-macos}" in
 macos) swift build --package-path "$repo/native/apple" --product AudeeoNative -c release --arch "${2:-$(uname -m)}" ;;
 *) echo 'Usage: sh scripts/apple-native-build.sh macos [arm64|x86_64]' >&2; exit 1 ;;
esac
