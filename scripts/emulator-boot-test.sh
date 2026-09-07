#!/usr/bin/env bash
#
# Emulator boot test for SillyTavern Android.
#
# Invoked by the android-emulator-runner action as ONE line:
#     script: bash scripts/emulator-boot-test.sh
# This indirection is REQUIRED: the action executes each line of its `script:`
# input in a separate fresh shell, so no multi-line logic (variables,
# functions, loops) can live inline in the workflow.
#
# Diagnostics-first design: every failure emits a ::error:: annotation
# (visible via the Checks API) and the full trace is tee'd to
# emulator-trace.txt, which the workflow uploads even when this fails.
#
# Exit status: 0 when the app installs, launches, and the backend answers
# /api/health; 1 otherwise.
set -u

cd "$(dirname "$0")/.." # repo root, regardless of caller cwd

TRACE=emulator-trace.txt
: > "$TRACE"
FAILED=0
note() { echo "$*" | tee -a "$TRACE"; }
fail() { echo "::error::$*"; note "FAIL: $*"; FAILED=1; }

note "=== device sanity ==="
adb devices | tee -a "$TRACE"
note "boot_completed=$(adb shell getprop sys.boot_completed 2>&1 | tr -d '\r')"

note "=== install ==="
BUILD_TYPE="${BUILD_TYPE:-debug}"
APK_PATH=$(ls android/app/build/outputs/apk/${BUILD_TYPE}/*.apk 2>/dev/null | head -n 1)
if [ -z "$APK_PATH" ]; then
    fail "no APK found under android/app/build/outputs/apk/${BUILD_TYPE}/"
else
    note "APK: $APK_PATH ($(du -h "$APK_PATH" | cut -f1))"
    INSTALL_OUT=$(adb install "$APK_PATH" 2>&1)
    note "$INSTALL_OUT"
    echo "$INSTALL_OUT" | grep -q "^Success" \
        || fail "adb install failed: $(echo "$INSTALL_OUT" | tr '\n' ' ' | head -c 500)"
fi
adb shell pm list packages 2>/dev/null | grep -i silly | tee -a "$TRACE" \
    || note "(com.sillytavern.app not in package list)"

note "=== launch ==="
START_OUT=$(adb shell am start -n com.sillytavern.app/.MainActivity 2>&1)
note "$START_OUT"

note "=== port forward (host:18080 -> emu:8000) ==="
adb forward tcp:18080 tcp:8000 2>&1 | tee -a "$TRACE"

note "=== health poll (up to 5 minutes) ==="
HEALTHY=false
for i in $(seq 1 60); do
    if BODY=$(curl -sf --max-time 5 http://127.0.0.1:18080/api/health 2>/dev/null); then
        note "attempt $i: $BODY"
        HEALTHY=true
        break
    fi
    [ $((i % 6)) -eq 0 ] && note "attempt $i: not up yet"
    sleep 5
done
[ "$HEALTHY" = "true" ] \
    || fail "backend never healthy after 5 min poll (port forward host:18080 -> emu:8000)"

note "=== logcat (SillyTavern/NodeJs) ==="
adb logcat -d 2>/dev/null | grep -E "(SillyTavern|NodeJsService)" | tail -n 200 | tee -a "$TRACE" | tail -n 20

note "=== process check ==="
PID=$(adb shell "pidof com.sillytavern.app" 2>/dev/null | tr -d '\r')
if [ -n "$PID" ]; then
    note "App process is running (pid $PID)"
else
    fail "app process NOT running"
fi

[ "$FAILED" = "0" ] || exit 1
note "EMULATOR TEST PASSED"
