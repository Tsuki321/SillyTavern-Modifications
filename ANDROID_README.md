# SillyTavern Android - Experimental Branch

This branch contains the Android application conversion of SillyTavern, transforming the web-based LLM frontend into a self-contained mobile application.

## 🎯 Project Goal

Create a fully-featured Android app that:
- ✅ Runs entirely on-device with embedded Node.js backend
- ✅ Maintains 95%+ feature parity with web version
- ✅ Provides mobile-optimized UI/UX
- ✅ Works completely offline (after initial setup)
- ✅ Delivers fast, responsive performance
- ✅ Built through GitHub Actions (no local compilation required)

## 🏗️ Architecture

**Capacitor + nodejs-mobile Hybrid Approach**

```
┌─────────────────────────────────────────┐
│     WebView (Capacitor)                 │
│  - Reuses existing HTML/CSS/JS          │
│  - Mobile-responsive UI                 │
├─────────────────────────────────────────┤
│     Mobile Bridge Layer                 │
│  - Server lifecycle management          │
│  - Android back button handling         │
│  - App pause/resume logic               │
├─────────────────────────────────────────┤
│     Embedded Node.js (nodejs-mobile)    │
│  - Express backend running locally      │
│  - All API endpoints unchanged          │
│  - localhost:3000 communication         │
├─────────────────────────────────────────┤
│     Android Scoped Storage              │
│  - Characters, chats, settings          │
│  - ML model cache                       │
│  - User-uploaded media                  │
└─────────────────────────────────────────┘
```

## 📁 Key Files

### Android-Specific Code
- `capacitor.config.json` - Capacitor configuration
- `public/mobile-bridge.js` - Mobile initialization & lifecycle
- `src/android-fs-adapter.js` - File system abstraction for Android
- `src/endpoints/health.js` - Health check endpoint
- `.github/workflows/android-build.yml` - CI/CD build pipeline

### Documentation
- `ANDROID_IMPLEMENTATION_PLAN.md` - Full 6-week implementation roadmap
- `ANDROID_DEV_GUIDE.md` - Developer setup & troubleshooting guide
- `ANDROID_TESTING_PLAN.md` - Comprehensive testing strategy

### Tests
- `tests/android/android-fs-adapter.test.js` - File system tests
- `tests/android/health-endpoint.test.js` - Health endpoint tests

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20
- Java 17 (Temurin)
- Android SDK (API 34)
- GitHub account (for Actions builds)

### Build via GitHub Actions (Recommended)

1. Go to **Actions** tab
2. Select **Android Build** workflow
3. Click **Run workflow**
4. Choose `debug` or `release`
5. Download APK from artifacts

### Local Development

```bash
# Install dependencies
npm install

# Install Capacitor
npx cap init SillyTavern com.sillytavern.app --web-dir=public
npx cap add android

# Sync
npx cap sync android

# Open in Android Studio
npx cap open android
```

See `ANDROID_DEV_GUIDE.md` for detailed instructions.

## ✅ Implementation Status

### ✅ Completed
- [x] Deep codebase analysis & feasibility study
- [x] Architecture design (Capacitor + nodejs-mobile)
- [x] GitHub Actions workflow (manual trigger)
- [x] Capacitor project configuration
- [x] Mobile bridge initialization layer
- [x] Android file system adapter
- [x] Health check endpoint
- [x] Test framework setup
- [x] Comprehensive documentation

### ⏳ In Progress
- [ ] nodejs-mobile plugin integration
- [ ] Android native layer (Java/Kotlin)
- [ ] First successful APK build
- [ ] Device testing (Pixel 6, Galaxy A51, etc.)

### 📋 Upcoming
- [ ] ML model download manager
- [ ] Android-native UI components
- [ ] Performance optimization
- [ ] Battery life optimization
- [ ] Beta testing program
- [ ] Play Store submission

## 🧪 Testing

```bash
# Run Android-specific unit tests
cd tests
npm run test:android

# Run all tests
npm test
```

See `ANDROID_TESTING_PLAN.md` for the complete testing strategy.

## 📊 Quality Targets

| Metric | Target | Status |
|--------|--------|--------|
| Cold Start Time | < 3s | ⏳ TBD |
| Memory Usage | < 512MB (low-end) | ⏳ TBD |
| Battery Drain | < 2%/hour | ⏳ TBD |
| APK Size | < 80MB | ⏳ TBD |
| Crash-Free Rate | > 99.5% | ⏳ TBD |
| Feature Parity | > 95% | ⏳ TBD |

## 🐛 Known Issues

None yet - this is a greenfield implementation.

## 📝 Development Workflow

### Making Changes
1. Make code changes
2. Commit to `android-experimentals` branch
3. Trigger GitHub Actions build
4. Monitor build logs
5. Download APK and test on device
6. If errors, fix from build logs and repeat

### No Local Compilation
All builds happen in GitHub Actions to ensure:
- Consistent build environment
- Build reproducibility  
- Proper artifact management
- No "works on my machine" issues

### Debugging
1. Check GitHub Actions logs for build errors
2. Use `adb logcat` for runtime logs
3. Monitor with Android Profiler for performance
4. Report issues with device/version/logs

## 🤝 Contributing

This is an experimental branch. Contributions welcome!

1. Read `ANDROID_DEV_GUIDE.md`
2. Check `ANDROID_IMPLEMENTATION_PLAN.md` for roadmap
3. Pick a task from "Upcoming" section
4. Test thoroughly per `ANDROID_TESTING_PLAN.md`
5. Submit PR with test results

## 📚 Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)
- [Android Developer Guide](https://developer.android.com/guide)
- [SillyTavern Docs](https://docs.sillytavern.app/)

## 📄 License

AGPL-3.0 (same as parent project)

## 🙏 Acknowledgments

- SillyTavern team for the excellent base application
- Capacitor team for the hybrid app framework
- nodejs-mobile team for Node.js on Android

---

**Status**: 🚧 Active Development  
**Last Updated**: 2026-06-10  
**Branch**: `android-experimentals`  
**Maintainer**: As directed by user
