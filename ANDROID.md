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

## Node.js runtime provisioning

There is no official standalone Node.js binary for Android, so CI fetches one from
the most reputable prebuilt source: **Termux's APT repository**. Termux cross-builds
standalone, bionic-linked Node.js from official nodejs.org sources plus Android
patches (currently Node 26.x) for aarch64/arm/i686/x86_64 and runs upstream's test
suite on every release.

`scripts/provision-android-runtime.sh` (run by CI, runnable locally too):

```sh
bash scripts/provision-android-runtime.sh --out <backend>/nodejs --abis arm64,armv7,x64
```

does the following per ABI:

1. Downloads the Termux `Packages` index over HTTPS (primary + mirror fallback).
2. Resolves `nodejs` plus every shared-dependency package from the nodejs recipe
   (`libc++`, `openssl`, `c-ares`, `libicu`, `libsqlite`, `zlib`, `libffi`).
3. Downloads each `.deb` and verifies its SHA-256 against the index.
4. Extracts `usr/bin/node` and `usr/lib/*.so*` into `<out>/<abi>/{node,lib/}`.
5. **ELF-validates everything**: correct machine type, Android linker
   (`/system/bin/linker[64]`, never Linux `ld-linux`), and every `DT_NEEDED`
   resolvable from the bundled lib dir or a small system-lib allowlist.
   A Linux (musl/glibc) binary or a missing dependency fails the build loudly.
6. Writes `<out>/runtime-manifest.json` (versions + hashes; also logged on device).

`NodeJsService` picks the dir matching `Build.SUPPORTED_ABIS`, restores the exec bit
(APK assets lose permission bits), and launches it with `LD_LIBRARY_PATH` pointed at
the runtime's `lib/` dir. Node.js embeds Mozilla's CA certificates, so outbound HTTPS
works with no extra CA provisioning; `HOME`/`TMPDIR` are set to app dirs.

Reproducible builds: pass `--nodejs-version <ver>` (CI exposes it as the
`nodejs_version` workflow input) to pin the Termux nodejs version; dependencies
always come from the same index snapshot. The script's offline self-test
(`--self-test`, also run by `tests/test:android`) covers parsing, `.deb` handling,
hash rejection, pinning, and the ELF-validation logic.

What does NOT work (verified during this port — do not retry):

- `nodejs-mobile`'s `libnode.so`: a shared library with no executable entry point and no
  JNI bridge in this project. Shipping the `.so` alone does nothing.
- `unofficial-builds.nodejs.org` `linux-*-musl` tarballs: Linux binaries, cannot execute
  on Android (bionic libc / different dynamic linker).
- Linux x86_64 `node` from CI runners: wrong OS *and* wrong CPU.

Size note: each ABI's runtime is ~60–90 MB uncompressed (~half that compressed in the
APK/AAB), dominated by ICU data. Debug builds ship arm64+armv7+x64 (x64 for the
emulator test); release builds ship arm64+armv7. If the install size approaches Play
limits, the follow-up is per-ABI delivery (APK splits or Play Asset Delivery).

Build-it-yourself alternative: cross-compile Node with the NDK
(`--dest-os=android`, see the `nodejs-mobile` patches and Termux's
`packages/nodejs/build.sh` for the required flags); drop the result into the same
`<abi>/{node,lib/}` layout and the service will use it unchanged.

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

- The Termux runtime has only been statically validated (ELF checks) plus CI's
  emulator health check — run the emulator test before cutting a release build.
- APK size: `public/` is currently shipped twice (Capacitor web assets + backend
  bundle), plus one Node runtime per ABI. Future optimizations: point `webDir` at a
  minimal loader shell; per-ABI runtime delivery (APK splits / Play Asset Delivery).
- No ProGuard/R8 tuning, no per-ABI splits yet.
- Extension auto-update is disabled (no git); model auto-downloads can be large —
  consider Wi-Fi-only guidance in the UI later.
