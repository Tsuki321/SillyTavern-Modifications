# Android Development Guide

## Prerequisites

- Node.js >= 20
- Java 17 (Temurin recommended)
- Android SDK (API 34)
- Gradle

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Capacitor (if not already initialized)

```bash
npm install -g @capacitor/cli
npx cap init SillyTavern com.sillytavern.app --web-dir=public
npx cap add android
```

### 3. Sync Capacitor

```bash
npx cap sync android
```

### 4. Build Backend Bundle

The GitHub Actions workflow handles this, but for local testing:

```bash
# Copy backend files to Android assets
mkdir -p android/app/src/main/assets/nodejs-project
cp -r src android/app/src/main/assets/nodejs-project/
cp server.js android/app/src/main/assets/nodejs-project/
cp package.json android/app/src/main/assets/nodejs-project/

# Install production dependencies
cd android/app/src/main/assets/nodejs-project
npm install --production --no-optional
cd -
```

### 5. Open in Android Studio

```bash
npx cap open android
```

## GitHub Actions Build

The Android build is configured to run via GitHub Actions **manual trigger only**.

### Trigger a Build

1. Go to **Actions** tab on GitHub
2. Select **Android Build** workflow
3. Click **Run workflow**
4. Choose build type:
   - `debug` - Development build with debugging enabled
   - `release` - Production build (requires signing keys)

### Build Artifacts

After a successful build, download artifacts:
- **Debug**: `sillytavern-debug-{run_number}.apk`
- **Release**: `sillytavern-release-{run_number}.apk` and `.aab`
- **Build Report**: `build-report-{run_number}`

### Setup Signing (Release Builds)

Add these secrets to your GitHub repository:

1. **ANDROID_KEYSTORE_BASE64**: Base64-encoded keystore file
   ```bash
   base64 -i keystore.jks | pbcopy
   ```

2. **KEYSTORE_PASSWORD**: Keystore password
3. **KEY_ALIAS**: Key alias name
4. **KEY_PASSWORD**: Key password

## Local Testing

### Debug Build

```bash
cd android
./gradlew assembleDebug
```

APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

### Install on Device

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Monitor Logs

```bash
adb logcat | grep -E "(SillyTavern|nodejs)"
```

## Architecture

```
┌─────────────────────────────────────────┐
│     WebView (Capacitor)                 │
│  - Existing HTML/CSS/JS frontend        │
├─────────────────────────────────────────┤
│     Mobile Bridge (mobile-bridge.js)    │
│  - Server lifecycle management          │
│  - Connection handling                  │
├─────────────────────────────────────────┤
│     nodejs-mobile                       │
│  - Embedded Node.js runtime             │
│  - Express server (localhost)           │
├─────────────────────────────────────────┤
│     Android Scoped Storage              │
│  - User data in app-specific directory  │
└─────────────────────────────────────────┘
```

## File Structure

```
android/
  app/
    src/
      main/
        assets/
          nodejs-project/     # Backend code bundle
            src/
            server.js
            package.json
        java/
          com/sillytavern/app/
public/
  mobile-bridge.js           # Mobile initialization
  capacitor.js               # Auto-generated
src/
  android-fs-adapter.js      # File system abstraction
  endpoints/
    health.js                # Health check endpoint
```

## Troubleshooting

### Server won't start

- Check logs: `adb logcat | grep nodejs`
- Verify assets bundle exists in APK
- Ensure permissions granted (Storage)

### UI not loading

- Check if server is running: `http://localhost:3000/api/health`
- Verify WebView version (requires Chrome 55+)
- Clear app data and restart

### File operations failing

- Grant storage permissions in Settings
- Check Android version (requires API 24+)
- Verify scoped storage paths

### Build failures

- Check GitHub Actions logs
- Ensure all secrets are configured (release builds)
- Verify Gradle wrapper permissions: `chmod +x android/gradlew`

## Performance Optimization

### APK Size Reduction

1. Enable ProGuard/R8 in `android/app/build.gradle`
2. Remove unused resources
3. Use WebP for images
4. Tree-shake dependencies

### Battery Optimization

1. Pause server when app backgrounded
2. Reduce polling frequency
3. Use WorkManager for background tasks
4. Implement Doze mode handling

### Memory Management

1. Monitor with Android Profiler
2. Set appropriate heap limits
3. Stream large file operations
4. Clear caches periodically

## Next Steps

1. ✅ Setup Capacitor project
2. ✅ Create GitHub Actions workflow
3. ✅ Add mobile bridge
4. ⏳ Integrate nodejs-mobile plugin
5. ⏳ Test on real devices
6. ⏳ Implement Android-specific UI enhancements
7. ⏳ Add model download manager
8. ⏳ Performance profiling
9. ⏳ Beta testing
10. ⏳ Play Store submission

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)
- [Android Developer Guide](https://developer.android.com/guide)
- [SillyTavern Docs](https://docs.sillytavern.app/)
