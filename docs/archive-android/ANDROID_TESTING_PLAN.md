# Android Testing Plan

## Testing Strategy

### 1. Unit Tests
### 2. Integration Tests  
### 3. UI Tests
### 4. Device Tests
### 5. Performance Tests
### 6. Security Tests

---

## 1. Unit Tests

### Backend Tests (Node.js)

```javascript
// tests/android/android-fs-adapter.test.js
describe('Android File System Adapter', () => {
    test('getDataRoot returns Android path on Android', () => {});
    test('toAndroidPath converts paths correctly', () => {});
    test('androidFS.writeFile creates parent directories', () => {});
    test('androidFS.readFile handles missing files', () => {});
});

// tests/android/health-endpoint.test.js
describe('Health Endpoint', () => {
    test('GET /api/health returns 200', () => {});
    test('Health response includes version', () => {});
    test('Health response includes platform', () => {});
});
```

### Frontend Tests (Mobile Bridge)

```javascript
// tests/android/mobile-bridge.test.js
describe('Mobile Server Bridge', () => {
    test('Detects Capacitor environment', () => {});
    test('Waits for server with retries', () => {});
    test('Handles server startup failure', () => {});
    test('Configures endpoints correctly', () => {});
    test('Handles app pause/resume', () => {});
});
```

---

## 2. Integration Tests

### Server Lifecycle

- [ ] Server starts successfully on app launch
- [ ] Server responds to health check within 5s
- [ ] Server serves frontend assets
- [ ] Server handles API requests correctly
- [ ] Server pauses on app background
- [ ] Server resumes on app foreground
- [ ] Server cleans up on app exit

### File Operations

- [ ] Create character file
- [ ] Read character file
- [ ] Update character file
- [ ] Delete character file
- [ ] Create chat file (.jsonl)
- [ ] Append to chat file
- [ ] Read chat history
- [ ] Export character (ZIP)
- [ ] Import character
- [ ] Handle storage full scenario

### API Endpoints

Test all critical endpoints:
- [ ] `/api/characters/all` - List characters
- [ ] `/api/characters/create` - Create character
- [ ] `/api/chats/get` - Load chat
- [ ] `/api/chats/save` - Save chat
- [ ] `/api/settings` - User settings
- [ ] `/api/tokenizers` - Token counting
- [ ] `/api/image-metadata` - Image processing

---

## 3. UI Tests (Espresso/Detox)

### Core User Flows

```javascript
describe('Character Management', () => {
    test('Create new character', async () => {
        // Navigate to character creation
        // Fill in character details
        // Upload avatar
        // Save character
        // Verify character appears in list
    });

    test('Start chat with character', async () => {
        // Select character
        // Type message
        // Send message
        // Verify message appears
    });
});

describe('Android-Specific', () => {
    test('Back button closes drawer', async () => {});
    test('App minimizes on back from main', async () => {});
    test('Share sheet exports character', async () => {});
    test('Image picker selects avatar', async () => {});
    test('Keyboard pushes content up', async () => {});
});
```

### Regression Tests

- [ ] All existing frontend features work
- [ ] Modal dialogs display correctly
- [ ] Dropdowns work on mobile
- [ ] Sliders are touch-friendly
- [ ] Scrolling is smooth
- [ ] Buttons have proper touch targets (48dp minimum)

---

## 4. Device Tests

### Test Matrix

| Device | Android Version | Screen | RAM | Status |
|--------|----------------|--------|-----|--------|
| Pixel 6 | 14 | 1080x2400 | 8GB | ⏳ |
| Galaxy A51 | 12 | 1080x2400 | 4GB | ⏳ |
| OnePlus 9 | 13 | 1440x3216 | 8GB | ⏳ |
| Xiaomi Redmi Note 9 | 11 | 1080x2340 | 4GB | ⏳ |
| Pixel 4a | 13 | 1080x2340 | 6GB | ⏳ |

### Test Scenarios

#### Low-End Device (4GB RAM)
- [ ] App launches without crash
- [ ] Cold start time < 5s
- [ ] Memory usage < 512MB
- [ ] No UI jank during scrolling
- [ ] Image processing doesn't cause ANR
- [ ] Can load 100+ message chat

#### Mid-Range Device (6-8GB RAM)
- [ ] Cold start time < 3s
- [ ] Memory usage stable over 1h usage
- [ ] ML models load successfully
- [ ] Caption/classification works
- [ ] Smooth 60fps UI

#### High-End Device (12GB+ RAM)
- [ ] All features work
- [ ] Large model inference viable
- [ ] Multiple concurrent operations

---

## 5. Performance Tests

### Benchmarks

#### Cold Start Time
- **Target**: < 3s on Pixel 6
- **Measurement**: App launch to UI interactive

```bash
adb shell am start -W com.sillytavern.app/.MainActivity
```

#### Memory Usage
- **Target**: < 512MB on low-end, < 1GB on mid-range
- **Measurement**: Android Profiler over 1h usage

```bash
adb shell dumpsys meminfo com.sillytavern.app
```

#### Battery Drain
- **Target**: < 2% per hour active use
- **Measurement**: Battery Historian

```bash
adb bugreport > bugreport.zip
```

#### APK Size
- **Target**: < 80MB
- **Measurement**: Build output

```bash
ls -lh android/app/build/outputs/apk/release/*.apk
```

### Load Tests

- [ ] Load character with 1000+ chat messages
- [ ] Process 50 images in succession
- [ ] Run 100 tokenization requests
- [ ] Generate 20 chat responses without restart
- [ ] Import 100 character cards
- [ ] Stress test 24h continuous usage

---

## 6. Security Tests

### Permissions

- [ ] App requests storage permission properly
- [ ] App explains why permissions needed
- [ ] App degrades gracefully if denied
- [ ] No excessive permissions requested

### Data Protection

- [ ] User data stored in app-specific directory
- [ ] No sensitive data in logs
- [ ] Backups encrypted (if enabled)
- [ ] No network traffic leaking user data

### Input Validation

- [ ] Character names sanitized
- [ ] File paths validated
- [ ] API inputs validated
- [ ] No SQL injection vectors (if using SQLite)
- [ ] No XSS vectors in chat display

---

## 7. Edge Cases

### Network

- [ ] Handle airplane mode gracefully
- [ ] Offline mode works
- [ ] No crashes on network change
- [ ] Model download resumes after interruption

### Storage

- [ ] Handle storage full gracefully
- [ ] Show clear error when out of space
- [ ] Clean up temp files on low storage
- [ ] Don't corrupt data on disk full

### App Lifecycle

- [ ] Handle app kill/restore correctly
- [ ] Restore UI state after background
- [ ] Handle low memory warnings
- [ ] Don't lose unsent messages

### Interruptions

- [ ] Handle phone calls during use
- [ ] Handle notifications appearing
- [ ] Handle split-screen mode
- [ ] Handle screen rotation

---

## Automated Testing Setup

### Jest Configuration (Unit Tests)

```json
{
  "testEnvironment": "node",
  "testMatch": ["**/tests/android/**/*.test.js"],
  "collectCoverage": true,
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

### Run Tests Locally

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# UI tests (requires connected device)
cd android
./gradlew connectedAndroidTest
```

### CI Integration

Tests run automatically on GitHub Actions after successful build:

```yaml
- name: Run Unit Tests
  run: npm run test:unit

- name: Run Integration Tests  
  run: npm run test:integration

- name: Upload Test Results
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: test-results/
```

---

## Quality Gates

Before merging to main:

- [ ] All unit tests pass (100%)
- [ ] Integration tests pass (100%)
- [ ] UI tests pass on 3+ devices
- [ ] Cold start < 3s on Pixel 6
- [ ] Memory usage < 512MB on low-end device
- [ ] Battery drain < 2%/hour
- [ ] APK size < 80MB
- [ ] No crashes in 24h stress test
- [ ] Code coverage > 80%
- [ ] No critical security issues

---

## Bug Tracking

### Bug Report Template

```markdown
**Device**: Pixel 6
**Android Version**: 14
**App Version**: 1.18.0-android-1
**Build**: Debug #42

**Steps to Reproduce**:
1. 
2. 
3. 

**Expected**: 
**Actual**: 
**Logs**: (attach adb logcat)
**Screenshots**: 
```

### Priority Levels

- **P0 - Critical**: Crashes, data loss, unusable
- **P1 - High**: Major features broken, poor UX
- **P2 - Medium**: Minor bugs, cosmetic issues
- **P3 - Low**: Nice-to-have improvements

---

## Test Execution Schedule

### Per Build
- Unit tests (automated)
- Integration tests (automated)
- Smoke tests (manual)

### Weekly
- Full regression suite
- Performance benchmarks
- 3-device compatibility test

### Pre-Release
- Full test matrix (5+ devices)
- 24h stress test
- Security audit
- Beta user testing

---

## Success Metrics

- **Test Coverage**: > 80%
- **Pass Rate**: > 95%
- **Crash-Free Rate**: > 99.5%
- **ANR Rate**: < 0.1%
- **Mean Time to Fix**: < 48h for P0, < 1 week for P1

---

## Resources

- [Android Testing Guide](https://developer.android.com/training/testing)
- [Espresso Documentation](https://developer.android.com/training/testing/espresso)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Battery Historian](https://developer.android.com/topic/performance/power/battery-historian)
