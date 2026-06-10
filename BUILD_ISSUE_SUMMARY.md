# Build Issue Summary & Next Steps

## Current Problem
The Android build is failing because we manually created the android folder structure instead of letting Capacitor generate it properly. This resulted in:
- Missing or corrupted Gradle wrapper files
- Incomplete build.gradle configuration
- Missing Capacitor-generated project structure

## What We've Tried
1. ✅ Added Capacitor dependencies to package.json
2. ✅ Updated package-lock.json
3. ✅ Created placeholder Node.js binaries
4. ✅ Created backend bundling workflow
5. ❌ Manual android folder - caused multiple issues

## Root Cause
Capacitor expects to generate the entire android folder structure with `npx cap add android`, but we manually created files which created conflicts.

## Solution
Need to start fresh with a proper Capacitor Android project:

1. Remove the manually created android folder
2. Run `npx cap add android` to let Capacitor generate everything
3. Customize only what's needed (MainActivity.java, NodeJsService.java)
4. Don't touch Gradle wrapper files - Capacitor provides them

## Quick Fix Script
```bash
# On local machine (since we can't afford to run locally, do this in workflow)
cd /path/to/SillyTavern-Modifications
rm -rf android
npx cap add android
git add android
git commit -m "feat: Capacitor-generated Android project"
git push
```

## Alternative: Fix in GitHub Actions
Add a step before build that regenerates Android project:
```yaml
- name: Regenerate Android project
  run: |
    rm -rf android
    npx cap add android
```

This ensures clean, proper Capacitor structure every time.

## Files to Restore After Regeneration
After `npx cap add android`, we need to add back:
- `android/app/src/main/java/com/sillytavern/app/MainActivity.java` (with Node.js service launcher)
- `android/app/src/main/java/com/sillytavern/app/NodeJsService.java` (Node.js process manager)
- Update `android/app/src/main/AndroidManifest.xml` (add service declaration)

## Recommendation
Since local builds aren't feasible, add the regeneration step to the workflow so every build starts with a clean Capacitor project, then applies our customizations.
