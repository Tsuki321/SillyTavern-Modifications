# Architecture Pivot - Alternative Approaches

## Issue Discovered

The `capacitor-nodejs` plugin is only compatible with Capacitor 3.x, but we need Capacitor 6.x for modern Android support. This is a **blocking technical issue** that requires a revised approach.

## Revised Architecture Options

### Option 1: React Native + nodejs-mobile-react-native ⭐ RECOMMENDED
**Shift from Capacitor to React Native**

**Pros:**
- nodejs-mobile-react-native is actively maintained
- Better native performance than WebView
- Proper Node.js integration
- Same codebase can be reused (95% backend, port frontend)

**Cons:**
- Must rewrite frontend (HTML/CSS → React Native components)
- 2-3 weeks additional effort
- Different skill set required

**Effort:** 4-6 weeks total (including frontend port)

---

### Option 2: Custom Capacitor 6 Plugin
**Build our own Node.js embedding plugin**

**Pros:**
- Works with Capacitor 6
- Full control over implementation
- Can use latest nodejs-mobile from JaneaSystems

**Cons:**
- Complex native Android development
- 2-4 weeks to build plugin alone
- Ongoing maintenance burden
- Risk of bugs and compatibility issues

**Effort:** 3-5 weeks for plugin + 2-3 weeks integration = 5-8 weeks total

---

### Option 3: WebSocket Bridge Architecture ⭐ PRAGMATIC
**Run Node.js as separate service, connect via WebSocket**

```
┌──────────────────────────┐
│   Capacitor WebView      │
│   (Frontend unchanged)   │
├──────────────────────────┤
│   WebSocket Client       │
│   (Connect to localhost) │
├──────────────────────────┤
│   Android Service        │
│   (Launch Node process)  │
├──────────────────────────┤
│   Node.js Binary         │
│   (Bundled in APK)       │
└──────────────────────────┘
```

**Implementation:**
- Bundle standalone Node.js binary for Android
- Launch as subprocess from Android Service
- Communicate via localhost WebSocket
- Frontend stays unchanged (WebView)

**Pros:**
- Keep Capacitor 6
- No frontend rewrite needed
- Node.js runs as standard process
- Simpler debugging
- Can use any Node.js version

**Cons:**
- Node.js binary adds ~50MB to APK
- Process management overhead
- Slightly higher battery drain
- More moving parts

**Effort:** 2-3 weeks

---

### Option 4: Termux-based Approach
**Embed Termux runtime + Node.js**

**Pros:**
- Proven solution (Termux works)
- Full Linux environment

**Cons:**
- Very large APK (200+ MB)
- GPL licensing issues
- Overkill for our needs

**Not Recommended**

---

### Option 5: Backend Server Required
**Remove embedded Node.js, require external server**

**Pros:**
- Simplest implementation
- Keep Capacitor as-is
- Works today

**Cons:**
- ❌ Violates core requirement (self-contained app)
- Requires network connectivity
- Not truly mobile

**Not Acceptable**

---

## Recommendation: Option 3 (WebSocket Bridge)

**Best balance of pragmatism and requirements:**

1. ✅ Keeps Capacitor 6 (modern, maintained)
2. ✅ No frontend rewrite (95% code reuse)
3. ✅ Self-contained (Node.js bundled in APK)
4. ✅ Works offline
5. ✅ Standard Node.js (no custom builds)
6. ✅ Reasonable timeline (2-3 weeks)

### Implementation Plan

#### Week 2: Node.js Process Integration
1. Download prebuilt Node.js binary for Android
2. Bundle in APK assets
3. Create Android Service to launch Node process
4. Setup WebSocket server in Node
5. Test process lifecycle

#### Week 3: Frontend Bridge
1. Update mobile-bridge.js for WebSocket
2. Handle reconnection logic
3. Test all API endpoints
4. Handle process crashes

#### Week 4: Polish & Test
1. Optimize startup time
2. Memory management
3. Battery optimization
4. Device testing

---

## Technical Details

### Node.js Binary for Android
- Use official Node.js Android builds
- Or: cross-compile using NDK
- Size: ~40-50MB per architecture
- Support: arm64-v8a, armeabi-v7a

### Process Management
```java
// Android Service
ProcessBuilder pb = new ProcessBuilder(
    nodeBinaryPath,
    "server.js"
);
pb.directory(new File(assetsDir));
Process nodeProcess = pb.start();
```

### Communication
```javascript
// Frontend: connect to Node.js via WebSocket
const ws = new WebSocket('ws://localhost:3000');

// Backend: WebSocket server
const wss = new WebSocketServer({ port: 3000 });
```

### Lifecycle
- App Start → Launch Node process
- App Pause → Keep process running (or pause)
- App Resume → Reconnect WebSocket
- App Kill → Clean shutdown

---

## Next Steps

1. ⏳ Validate this approach with proof-of-concept
2. ⏳ Download Node.js Android binary
3. ⏳ Test launching Node from Android Service
4. ⏳ Update implementation plan
5. ⏳ Update GitHub Actions workflow

---

## Decision Required

**Proceed with Option 3 (WebSocket Bridge)?**

This is the most pragmatic path forward given:
- Capacitor 6 compatibility requirement
- nodejs-mobile plugin obsolescence
- Need to maintain code reuse
- Timeline constraints

Alternative: Pivot to React Native (Option 1) for better long-term maintainability, but accept 2-3 week delay for frontend port.
