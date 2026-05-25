# Building a Distribution-Signed `.ipa` for App Automate

This guide walks through the one-time setup needed to ship a Storybook host app to BrowserStack App Automate for iOS testing. **The SDK cannot do this for you** — Apple's signing flow requires your Apple Developer account, your provisioning profile, and your distribution certificate. The SDK takes over after you have a signed `.ipa`.

If you're testing locally on an iOS Simulator (no BrowserStack), skip this guide — Simulator builds don't need signing. See `STORYBOOK_HOST_APP.md` for the simulator path.

## Prerequisites

| | Why |
|---|---|
| Apple Developer Program membership ($99/year) | Required to generate distribution certs + provisioning profiles |
| macOS with Xcode 15+ | iOS builds only work on macOS |
| Your app's bundle identifier registered in App Store Connect | Provisioning profiles bind to a specific bundle ID |
| BrowserStack App Automate plan with iOS device coverage | Standard plan covers Pixel/Android; iOS may need an upgrade |

## The signing artifacts you need to produce

| Artifact | What it is | How to get it |
|---|---|---|
| **Distribution certificate** | A `.p12` file in your login Keychain that proves you're the developer | Generate via Xcode → Settings → Accounts → Manage Certificates → "+" → "Apple Distribution" |
| **App ID** | A unique identifier registered with Apple matching your bundle id | https://developer.apple.com/account/resources/identifiers — Register App ID for `com.your-org.your-app` |
| **Provisioning profile** | A file that pairs your cert + App ID for distribution | https://developer.apple.com/account/resources/profiles — "Ad Hoc" type, select your App ID + your distribution cert |

Ad Hoc is the right profile type for App Automate. App Store distribution profiles require additional review steps; Development profiles are limited to devices you've registered.

## Configuring your project

Inside `ios/MyApp.xcodeproj`:

1. Select the project root → your app target → **Signing & Capabilities**
2. **Uncheck** "Automatically manage signing" (we'll specify the cert + profile explicitly so the same build works in CI)
3. Set **Provisioning Profile**: select the Ad Hoc profile you generated above
4. Set **Code Signing Identity**: select "Apple Distribution: Your Team Name"

If you have multiple build configurations (Debug, Release), apply the same settings to both. App Automate runs against your Release variant.

## Building the `.ipa`

```bash
# 1. Archive
xcodebuild -workspace ios/MyApp.xcworkspace \
  -scheme MyApp-Storybook \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath ./build/MyApp-Storybook.xcarchive \
  CODE_SIGN_IDENTITY="Apple Distribution: Your Team Name" \
  PROVISIONING_PROFILE_SPECIFIER="MyApp Storybook Ad Hoc" \
  archive

# 2. Export to .ipa
xcodebuild -exportArchive \
  -archivePath ./build/MyApp-Storybook.xcarchive \
  -exportPath ./build/ipa \
  -exportOptionsPlist ./ios/ExportOptions.plist

# Resulting file: ./build/ipa/MyApp-Storybook.ipa
```

`ExportOptions.plist` (next to `MyApp.xcodeproj`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>ad-hoc</string>
  <key>teamID</key>
  <string>YOUR_TEAM_ID</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.your-org.your-app</key>
    <string>MyApp Storybook Ad Hoc</string>
  </dict>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
</dict>
</plist>
```

## URL scheme registration (deep-link mode)

Same as Android — register a URL scheme so the SDK's deep-link navigation can route stories. Add to `ios/MyApp/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

For Expo projects, set `"scheme": "myapp"` in `app.json` and re-run `npx expo prebuild --platform ios` — Expo generates the `Info.plist` entry.

## Uploading + running

Once you have the `.ipa`:

```js
import { provisionApp } from '@percy/storybook-react-native';

const appRef = await provisionApp('./build/ipa/MyApp-Storybook.ipa');
// → bs://...
```

The SDK's `provisionApp` flow is platform-agnostic — same multipart upload + `custom_id` dedup as Android. Just point it at the `.ipa` and it returns the `bs://` reference.

Then in your wdio session:

```js
await wdio.remote({
  hostname: 'hub.browserstack.com',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:app': appRef,
    'appium:deviceName': 'iPhone 15 Pro',
    'appium:platformVersion': '17.4',          // 16.4+ for deep-link
    'bstack:options': { userName, accessKey, ... },
  },
});
```

## Failure modes (read these before filing an issue)

| Symptom | Likely cause | Fix |
|---|---|---|
| Session opens but device shows "Untrusted Developer" | Your dist cert isn't trusted by the BS device profile | BS auto-trusts certs from accounts paired with your BS account — contact BS support if persists |
| `App installation failed` immediately after session start | Provisioning profile expired or bundle id mismatch | Regenerate profile in Apple Dev portal; verify `Info.plist` `CFBundleIdentifier` matches the profile's App ID |
| `BROWSERSTACK_INVALID_OS_VERSION` for iPhone X | BS dropped support for older iOS versions on newer devices | Use a current device + OS from https://www.browserstack.com/list-of-browsers-and-platforms/app_automate |
| Deep-link doesn't navigate; snapshot is of the wrong story | iOS < 16.4, OR URL scheme not in `Info.plist`, OR `appScheme` mismatch | SDK fails fast on iOS < 16.4 with `deep_link_unsupported_platform`. For the other two, check `Info.plist` `CFBundleURLTypes` and the `appScheme` opt passed to `snapshotStory`. |
| Build hangs on archive step | Xcode's code-signing GUI prompt waiting for keychain access | Run `security unlock-keychain ~/Library/Keychains/login.keychain-db` in CI before xcodebuild |

## CI integration

Same pattern as Android — provide creds + the local `.ipa` path:

```yaml
# .github/workflows/percy-ios.yml
- name: Sign + build .ipa
  run: bash scripts/build-ios-release.sh   # your project's build script
  env:
    APPLE_DIST_CERT_P12: ${{ secrets.APPLE_DIST_CERT_P12 }}
    APPLE_DIST_CERT_PASSWORD: ${{ secrets.APPLE_DIST_CERT_PASSWORD }}
    APPLE_PROVISIONING_PROFILE: ${{ secrets.APPLE_PROVISIONING_PROFILE }}

- name: Run Percy via App Automate
  run: npx percy app:exec -- npm run ios
  env:
    BROWSERSTACK_USERNAME: ${{ secrets.BROWSERSTACK_USERNAME }}
    BROWSERSTACK_ACCESS_KEY: ${{ secrets.BROWSERSTACK_ACCESS_KEY }}
    PERCY_TOKEN: ${{ secrets.PERCY_TOKEN }}
    PERCY_APP_PATH: ./build/ipa/MyApp-Storybook.ipa
    PERCY_APP_SCHEME: myapp
```

The Apple-side secrets (`APPLE_DIST_CERT_P12`, `APPLE_PROVISIONING_PROFILE`) need to be base64-encoded and decoded at CI time before being installed in the runner's keychain. See [fastlane's `setup_ci`](https://docs.fastlane.tools/actions/setup_ci/) action for the canonical pattern — most teams use fastlane here even when they don't use it for other steps.

## What this guide cannot help with

- **Apple Developer Program enrollment** — that's a one-time $99 yearly purchase via apple.com, takes ~24h for individuals, longer for orgs
- **Lost/expired certificates** — recover via Apple Developer portal; if cert is past expiry, generate a new one and re-sign
- **Cross-org collaborators** — multiple developers need separate certs OR enroll under the same Apple Dev team

If you hit a roadblock here that's not in the Failure modes table, please file an issue at [`percy/percy-react-native-support`](https://github.com/percy/percy-react-native-support/issues) with the exact xcodebuild output (with cert names + team ID redacted).
