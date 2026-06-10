# Android Implementation Plan

## Architecture: Capacitor + nodejs-mobile

### Overview
Convert SillyTavern into a self-contained Android app using:
- **Capacitor**: WebView wrapper + native plugins
- **nodejs-mobile**: Embedded Node.js runtime for Express backend
- **Existing codebase**: 95% reuse with minimal modifications

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Project Setup
- [ ] Install Capacitor CLI and dependencies
- [ ] Initialize Capacitor project with Android platform
- [ ] Configure build paths to use existing `public/` as web root
- [ ] Add nodejs-mobile Capacitor plugin
- [ ] Bundle backend code for mobile deployment

### 1.2 Backend Integration
- [ ] Create Node.js bridge layer (server lifecycle management)
- [ ] Configure Express to use localhost with dynamic port
- [ ] Implement Android file system abstraction layer
- [ ] Map `data/` directory to Android scoped storage
- [ ] Test server start/stop on app lifecycle events

### 1.3 Frontend Modifications
- [ ] Update API endpoints to use `http://localhost:PORT`
- [ ] Add connection retry logic for server startup delay
- [ ] Implement loading screen during Node.js initialization
- [ ] Add Android back button handling

**Deliverable**: APK that launches, starts Node server, loads UI

---

## Phase 2: Core Features (Week 3-4)

### 2.1 Storage & Permissions
- [ ] Implement Capacitor filesystem plugin wrappers
- [ ] Request storage permissions on first launch
- [ ] Create migration script for existing user data structure
- [ ] Add SQLite for chat history (optional optimization)
- [ ] Test character/chat CRUD operations

### 2.2 Media Handling
- [ ] Integrate Android image picker for avatars/backgrounds
- [ ] Implement content provider for media library access
- [ ] Configure JIMP to work with Android file URIs
- [ ] Add camera capture for profile pictures
- [ ] Test image upload/display/cropping

### 2.3 ML Model Management
- [ ] Create model download manager UI
- [ ] Implement background download with progress tracking
- [ ] Configure transformers.js for Android (numThreads=1)
- [ ] Add model cache in Android cache directory
- [ ] Test caption/classification/embeddings on device

**Deliverable**: Functional app with core features working

---

## Phase 3: Optimization (Week 5)

### 3.1 Performance
- [ ] Reduce APK size (tree-shake, compress assets)
- [ ] Optimize cold start time (preload critical assets)
- [ ] Implement server pause/resume on app background
- [ ] Add memory pressure monitoring
- [ ] Profile and fix UI jank on low-end devices

### 3.2 Battery & Resource Management
- [ ] Disable background polling when app inactive
- [ ] Clean up WebSocket listeners on pause
- [ ] Implement adaptive polling rates
- [ ] Add low-power mode detection
- [ ] Test battery drain over 24h usage

### 3.3 Mobile UI Enhancements
- [ ] Add Android bottom navigation
- [ ] Implement swipe gestures (back, menu)
- [ ] Handle keyboard IME properly
- [ ] Add haptic feedback
- [ ] Support Android share sheet for exports

**Deliverable**: Optimized, production-ready app

---

## Phase 4: Testing & Quality (Week 6)

### 4.1 Testing Strategy
- [ ] Unit tests for Android-specific code
- [ ] Integration tests for server lifecycle
- [ ] UI tests with Espresso/Detox
- [ ] Test on 5+ different devices (API 24-34)
- [ ] Memory leak detection with LeakCanary
- [ ] Stress test with large character collections

### 4.2 Edge Cases
- [ ] Handle server startup failures gracefully
- [ ] Test offline mode (airplane mode)
- [ ] Handle storage full scenarios
- [ ] Test app kill/restore state
- [ ] Verify data integrity after crashes

### 4.3 Documentation
- [ ] User guide for Android-specific features
- [ ] Troubleshooting guide
- [ ] Build/deployment instructions
- [ ] Migration guide from web version

**Deliverable**: Stable, tested release candidate

---

## GitHub Actions Workflow

### Build Pipeline (Manual Trigger Only)
```yaml
name: Android Build

on:
  workflow_dispatch:
    inputs:
      build_type:
        description: 'Build type'
        required: true
        default: 'debug'
        type: choice
        options:
          - debug
          - release

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - Checkout code
      - Setup Node.js
      - Install dependencies
      - Setup Capacitor
      - Setup Android SDK
      - Bundle backend for mobile
      - Build APK/AAB
      - Run tests
      - Upload artifacts
      - Report build status
```

---

## Key Technical Decisions

### File System Strategy
- Use Android scoped storage (`getExternalFilesDir()`)
- Keep JSON/JSONL format for compatibility
- Add SQLite index for fast search (optional)

### Model Delivery
- Bundle lightweight models in APK (~50MB quantized)
- Lazy download full models on first use
- Cache in `getCacheDir()` with cleanup policy

### Offline Support
- Full offline after initial model download
- No cloud dependency for core features
- Optional cloud sync for backups

### Performance Targets
- Cold start: < 3s
- Memory usage: < 512MB on low-end devices
- APK size: < 80MB
- Battery drain: < 2% per hour active use

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OOM on low-end devices | Heap limits, stream processing, quantized models |
| Cold start time | Background service, warm cache |
| Battery drain | Pause server on background, optimize polling |
| Model download failures | Retry logic, resumable downloads, bundled fallback |
| Storage permissions denied | Graceful degradation, clear error messages |
| WASM threading issues | Force single-thread, test on API 24+ |

---

## Success Metrics

- [ ] APK builds successfully in CI
- [ ] App launches in < 3s on Pixel 6
- [ ] All core features work offline
- [ ] Battery drain < 2%/hour
- [ ] No crashes in 24h stress test
- [ ] Memory stable over 1000 chat messages
- [ ] 95% feature parity with web version

---

## Post-MVP Enhancements

- Push notifications for response completion
- Android Auto integration
- Wear OS companion app
- Multi-window/split-screen support
- Android 14+ predictive back animations
- Material You dynamic theming
