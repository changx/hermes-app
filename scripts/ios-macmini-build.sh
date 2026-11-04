#!/bin/bash
# Copy to ~/hermes-ios-build/build.sh on the Mac mini; the source tree goes to ~/hermes-ios-build/src (docs/ios-testflight-updates.md).
# Runs on the Mac mini: prebuild, pods, runtime check, signed Release archive and App Store .ipa export.
# Usage: bash build.sh <build number> <expected runtime version>
BUILD_NUMBER="${1:?build number}"
EXPECT_RUNTIME="${2:?expected runtime version}"
ROOT="$HOME/hermes-ios-build"
LOG="$ROOT/build.log"
exec > "$LOG" 2>&1
fail() { echo "exit=1 ($1)"; exit 1; }
step() { echo "== $(date +%H:%M:%S) $1"; }
export PATH="$HOME/.local/node-v24.14.1/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG=en_US.UTF-8 CI=1 EXPO_NO_TELEMETRY=1
TEAM=4R5932XFRV
cd "$ROOT/src/apps/mobile" || fail cd
# The update fingerprint skips gitignored native folders only inside a git repository.
git -C "$ROOT/src" rev-parse --git-dir >/dev/null 2>&1 || git -C "$ROOT/src" init -q || fail git-init
git -C "$ROOT/src" check-ignore -q apps/mobile/ios || fail ios-not-ignored

step prebuild
rm -rf ios
npx expo prebuild --platform ios --no-install || fail prebuild
WS=$(ls -d ios/*.xcworkspace 2>/dev/null | head -1)
SCHEME=$(basename "$(ls -d ios/*.xcodeproj | head -1)" .xcodeproj)
echo "scheme=$SCHEME"

step pods
(cd ios && pod install) || fail pods
WS=$(ls -d ios/*.xcworkspace | head -1)
echo "workspace=$WS"

step runtime
RV=$(npx expo-updates runtimeversion:resolve --platform ios | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).runtimeVersion))')
echo "runtime=$RV expected=$EXPECT_RUNTIME"
[ "$RV" = "$EXPECT_RUNTIME" ] || fail runtime-mismatch

step plist
PLIST="ios/$SCHEME/Info.plist"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST" 2>/dev/null
for key in CFBundleShortVersionString CFBundleVersion ITSAppUsesNonExemptEncryption NSPhotoLibraryUsageDescription NSCameraUsageDescription NSMicrophoneUsageDescription; do
  echo "$key=$(/usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" 2>/dev/null)"
done
EXPO_PLIST="ios/$SCHEME/Supporting/Expo.plist"
for key in EXUpdatesURL EXUpdatesRuntimeVersion EXUpdatesCheckOnLaunch EXUpdatesLaunchWaitMs EXUpdatesCodeSigningMetadata; do
  echo "$key=$(/usr/libexec/PlistBuddy -c "Print :$key" "$EXPO_PLIST" 2>/dev/null)"
done

step archive
ARCHIVE="$ROOT/out/HermesApp-$BUILD_NUMBER.xcarchive"
rm -rf "$ARCHIVE"
xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive > "$ROOT/archive.log" 2>&1 || { tail -40 "$ROOT/archive.log"; fail archive; }
tail -3 "$ROOT/archive.log"

step export
cat > "$ROOT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
EOF
EXPORT="$ROOT/out/export-$BUILD_NUMBER"
rm -rf "$EXPORT"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
  -exportOptionsPlist "$ROOT/ExportOptions.plist" -allowProvisioningUpdates \
  > "$ROOT/export.log" 2>&1 || { tail -40 "$ROOT/export.log"; fail export; }
ls -la "$EXPORT"

step verify
IPA=$(ls "$EXPORT"/*.ipa | head -1)
TMPV=$(mktemp -d); (cd "$TMPV" && unzip -q "$IPA")
APP=$(ls -d "$TMPV"/Payload/*.app | head -1)
codesign -dvv "$APP" 2>&1 | grep -E "Authority|Identifier|TeamIdentifier"
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Print :EXUpdatesRuntimeVersion" "$APP/Expo.plist" 2>/dev/null || find "$APP" -name Expo.plist -maxdepth 3
security cms -D -i "$APP/embedded.mobileprovision" | plutil -extract Name raw - 2>/dev/null
rm -rf "$TMPV"
echo "ipa=$IPA"
echo "exit=0"
