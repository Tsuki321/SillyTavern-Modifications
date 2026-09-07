# SillyTavern Android Port

Single source of truth for the Android port. (Historical build logs and superseded plans
live in `docs/archive-android/` — do not treat them as current.)

## Architecture

```
+----------------------------------------------------+
| Android app (Capacitor shell)                      |
|  MainActivity: starts NodeJsService, hosts WebView |
|  WebView boot shell: public/index.html +           |
|    public/mobile-bridge.js (splash -> redirect)    |
+-------------------------+--------------------------+
                          |  http://127.0.0.1:8000/
                          v
+----------------------------------------------------+
| NodeJsService (foreground service)                 |
|  - extracts assets/backend -> files/backend        |
|    (recursive, VERSION-stamped, re-extracts on     |
|    app update; user data lives OUTSIDE it)         |
|  - launches: node server.js --port 8000            |
|      --dataRoot files/st-data                      |
|      --configPath files/st-config/config.yaml      |
|  - pumps Node logs to logcat, polls /api/health    |
|  - stops Node on service stop / task removed       |
+-------------------------+--------------------------+
                          | serves (same-origin)
                          v
| WebView navigates to the backend. The full         |
| SillyTavern frontend is served BY the backend,     |
| so all existing relative /api/* calls, cookies,    |
| and CSRF handling work unchanged.                  |
+----------------------------------------------------+
```

Key files:

| Path | Role |
|---|---|
| `android-custom/` | Native sources (source of truth; CI copies them into the regenerated project) |
| `public/mobile-bridge.js` | Boot splash, health wait, backend redirect, lifecycle/back-button |
| `src/endpoints/health.js` | `GET /api/health` readiness probe |
| `capacitor.config.json` | Capacitor shell config |
| `.github/workflows/android-build.yml` | The only Android CI workflow |

## Node.js runtime provisioning (READ THIS FIRST)

There is no official standalone Node.js binary for Android, and the service needs one.
`NodeJsService` executes `backend/nodejs/node-<abi>` where `<abi>` is one of
`node-arm64` (arm64-v8a), `node-armv7` (armeabi-v7a), `node-x64` (x86_64 emulator),
`node-x86` (x86 emulator).

To provide it, place working Android (bionic) binaries at:

```
mobile-runtime/node-arm64
mobile-runtime/node-armv7
mobile-runtime/node-x64   # needed for emulator tests
```

(`mobile-runtime/` is gitignored.) CI bundles whatever is there into the APK.

What does NOT work (verified during this port — do not retry):

- `nodejs-mobile`'s `libnode.so`: a shared library with no executable entry point and no
  JNI bridge in this project. Shipping the `.so` alone does nothing.
- `unofficial-builds.nodejs.org` `linux-*-musl` tarballs: Linux binaries, cannot execute
  on Android (bionic libc / different dynamic linker).
- Linux x86_64 `node` from CI runners: wrong OS *and* wrong CPU.

Known routes to a working binary: cross-compile Node for Android with the NDK (the
`nodejs-mobile` project maintains the required patches), or vendor a trusted
third-party Android build. Until one is provided, builds succeed but the app reports
`No Node.js runtime bundled for this device` on launch — loudly and on purpose.

## Building

CI (`Android Build` workflow, manual dispatch):

1. `npm ci`, then Android unit tests (`tests/test:android`).
2. Regenerates `android/` from scratch (`npx cap add android`), overlays `android-custom/`,
   runs `npx cap sync android`. **The `android/` tree is generated — never commit it.**
3. Stages the backend (`server.js`, `src/`, `default/`, `public/`, real `package.json` +
   lockfile, `npm ci --omit=dev`) plus `VERSION` and any `mobile-runtime/` binaries.
4. Verifies the bundle (fails the build if server files or required deps are missing).
5. Builds debug APK, or release APK+AAB and signs them (`apksigner` for APK,
   `jarsigner` for AAB) using the `ANDROID_KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` /
   `KEY_ALIAS` / `KEY_PASSWORD` secrets.
6. Optional emulator test on API 34: installs, launches, forwards device port 8000,
   and polls `/api/health` from the runner.

Release signing secrets must all be set or the release build fails fast.

## Mobile runtime behavior (intentional differences from desktop)

- Server args are fixed by the service: `--port 8000`, `--dataRoot files/st-data`,
  `--configPath files/st-config/config.yaml`. `listen` stays off (loopback only);
  the default whitelist already allows `127.0.0.1`/`::1`.
- `SILLYTAVERN_EXTENSIONS_AUTOUPDATE=false` is set: there is no `git` binary on-device.
- `tiktoken` and `sillytavern-transformers` (onnxruntime) load lazily. If their native
  bindings are absent/broken on the device, the server still boots; only the
  tiktoken-backed counting and local-ML (classify/caption/STT/TTS/embeddings) endpoints
  degrade. Desktop behavior is unchanged (modules load, everything works).
- Back button: closes topmost `<dialog class="popup">` via its own `cancel` path, then
  open drawers (`.drawer-content.openDrawer` via `.drawer-toggle`), else minimizes.
- Pause/resume dispatches `sillytavern:mobile-pause` / `sillytavern:mobile-resume`
  window events; resume re-checks backend health and re-waits if the OS killed it.

## Testing

- `cd tests && npm run test:android` — health endpoint + bridge unit tests (no device).
- Emulator: dispatch the workflow with `run_emulator_tests: true` (requires an x64
  runtime binary in `mobile-runtime/` for the health check to pass).
- Manual: `adb logcat | grep -E 'SillyTavern|NodeJsService'` shows service + Node logs.

## Known limitations / roadmap

- No Node runtime is bundled yet (see provisioning above) — the remaining blocker.
- APK size: `public/` is currently shipped twice (Capacitor web assets + backend
  bundle). Future optimization: point `webDir` at a minimal loader shell.
- No ProGuard/R8 tuning, no per-ABI splits yet.
- Extension auto-update is disabled (no git); model auto-downloads can be large —
  consider Wi-Fi-only guidance in the UI later.
