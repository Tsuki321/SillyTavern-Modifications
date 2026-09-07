#!/usr/bin/env bash
#
# provision-android-runtime.sh - fetch a standalone Node.js runtime for Android.
#
# Source: Termux's APT repository (https://packages.termux.dev). Termux builds
# standalone, bionic-linked Node.js binaries for aarch64/arm/i686/x86_64 from
# official nodejs.org sources plus Android patches, and tests them every release.
# There is no official standalone Node.js binary for Android; this is the most
# reputable prebuilt available. (See ANDROID.md for the build-it-yourself alternative.)
#
# What this script does, per ABI:
#   1. Downloads the Termux Packages index (HTTPS) and parses the entries for
#      nodejs plus every package in TERMUX_PKG_DEPENDS of the nodejs recipe
#      (libc++, openssl, c-ares, libicu, libsqlite, zlib, libffi).
#   2. Downloads each .deb and verifies its SHA-256 against the index.
#   3. Extracts usr/bin/node and usr/lib/*.so into  <out>/<abi>/node|lib/.
#   4. Validates each ELF: correct machine type, Android linker
#      (/system/bin/linker[64], NOT Linux ld-linux), and every DT_NEEDED entry
#      resolvable from the bundled lib dir or a small system-lib allowlist.
#   5. Writes <out>/runtime-manifest.json (versions + hashes, for audit/debug).
#
# Trust model: TLS + hash verification. The index and debs come from the same
# HTTPS session, so a network attacker cannot substitute binaries undetected;
# Termux's infrastructure itself is trusted (same as trusting npmjs for `npm ci`).
# Use --nodejs-version to pin reproducible builds.
#
# Layout produced:
#   <out>/runtime-manifest.json
#   <out>/arm64/node  <out>/arm64/lib/*.so   (aarch64 devices)
#   <out>/armv7/node  <out>/armv7/lib/*.so   (armeabi-v7a devices)
#   <out>/x64/node    <out>/x64/lib/*.so     (x86_64 emulator / rare devices)
#   <out>/x86/node    <out>/x86/lib/*.so     (x86 emulator, rarely needed)
#
# NodeJsService maps Build.SUPPORTED_ABIS onto these dirs and sets
# LD_LIBRARY_PATH to the selected lib dir before exec.
#
# Usage:
#   provision-android-runtime.sh --out DIR [--abis arm64,armv7,x64]
#       [--repo URL]... [--nodejs-version VER] [--skip-elf-check]
#   provision-android-runtime.sh --self-test   # offline self-test, no network
#
set -euo pipefail

# Packages providing node + every shared library it DT_NEEDEDs.
# MUST match TERMUX_PKG_DEPENDS of packages/nodejs/build.sh in termux-packages.
# If Termux adds a dependency, the NEEDED validation below fails loudly naming it.
readonly DEP_PKGS="nodejs libc++ openssl c-ares libicu libsqlite zlib libffi"

readonly DEFAULT_REPOS=(
    "https://packages.termux.dev/apt/termux-main"
    "https://grimler.se/termux/termux-main"
)

# System (bionic) libraries guaranteed present on API 24+ devices.
# Everything else in DT_NEEDED must be shipped in our lib dir.
readonly SYSTEM_LIBS="libc.so libm.so libdl.so liblog.so libandroid.so libz.so"

READELF_BIN="${READELF_BIN:-readelf}"

# NOTE: log goes to stderr. provision_abi's ONLY stdout output is the resolved
# nodejs version, which main() captures via command substitution.
log()  { echo "[runtime] $*" >&2; }
die() {
    echo "[runtime] ERROR: $*" >&2
    # Also emit a workflow annotation so the failure reason is visible via the
    # Checks API even when step logs are unavailable.
    local msg="$*"
    msg="${msg//%/%25}"
    echo "::error::$msg" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# ABI mapping
# ---------------------------------------------------------------------------
# Our ABI tag -> Termux arch | readelf Machine | Android linker
abi_info() {
    case "$1" in
        arm64) echo "aarch64|AArch64|/system/bin/linker64" ;;
        armv7) echo "arm|ARM|/system/bin/linker" ;;
        x64)   echo "x86_64|X86-64|/system/bin/linker64" ;;
        x86)   echo "i686|80386|/system/bin/linker" ;;
        *)     return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# APT index handling
# ---------------------------------------------------------------------------
fetch_url() { # $1=url $2=dest
    curl -fsSL --retry 3 --retry-delay 2 --max-time 120 -o "$2" "$1"
}

# Download the Packages index for a Termux arch, trying each repo mirror.
# Prints "<repo-root> <index-file>" on stdout.
fetch_index() { # $1=termux-arch $2=tmpdir $3...=repos
    local arch="$1" tmpdir="$2"; shift 2
    local repo index_file errors=""
    index_file="$tmpdir/Packages.$arch"
    for repo in "$@"; do
        # file:// repos (self-test) and https repos alike.
        if fetch_url "$repo/dists/stable/main/binary-$arch/Packages" "$index_file" 2>/dev/null; then
            echo "$repo $index_file"
            return 0
        fi
        errors="$errors [$repo]"
    done
    die "Could not download Packages index for arch '$arch' from any mirror:$errors"
}

# Parse one stanza from a Packages index. Prints "filename|sha256|version".
parse_pkg() { # $1=index-file $2=pkg-name [$3=version-prefix-pin]
    local index="$1" pkg="$2" pin="${3:-}"
    awk -v pkg="$pkg" -v pin="$pin" '
        BEGIN { RS=""; FS="\n" }
        {
            name=""; file=""; sha=""; ver="";
            for (i=1; i<=NF; i++) {
                if ($i ~ /^Package: /)         name=substr($i, 10);
                else if ($i ~ /^Filename: /)  file=substr($i, 11);
                else if ($i ~ /^SHA256: /)    sha=substr($i, 9);
                else if ($i ~ /^Version: /)   ver=substr($i, 10);
            }
            if (name == pkg && (pin == "" || index(ver, pin) == 1)) {
                print file "|" sha "|" ver;
                found=1;
                exit 0;
            }
        }
        END { if (!found) exit 1; }
    ' "$index"
}

sha256_of() { # $1=file -> prints hash (sha256sum or shasum fallback for macOS)
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        die "Need sha256sum or shasum to verify downloads"
    fi
}

# ---------------------------------------------------------------------------
# .deb extraction
# ---------------------------------------------------------------------------
# Extract usr/bin/node from a nodejs .deb into $2, usr/lib/*.so* into $3.
extract_deb() { # $1=deb $2=dest-bin-file $3=dest-lib-dir $4=want ("bin"|"lib")
    local deb="$1" work data_member
    work="$(mktemp -d)"
    # Expand $work NOW (double quotes): a trap referencing a function-local
    # fires after locals are destroyed under `set -u`. Cleared before return.
    # shellcheck disable=SC2064
    trap "rm -rf '$work'" RETURN
    data_member="$(ar t "$deb" | grep '^data\.tar' | head -n 1)"
    [ -n "$data_member" ] || die "No data.tar.* member in $deb (not a valid .deb?)"
    # NOTE: extract to a regular file first. GNU tar cannot auto-detect
    # compression on a pipe (stdin is not seekable).
    ar p "$deb" "$data_member" > "$work/data.tar"
    ( cd "$work" && tar -xf data.tar )
    if [ "$4" = "bin" ]; then
        local node_src
        node_src="$(find "$work" -path '*usr/bin/node' -type f | head -n 1)"
        [ -n "$node_src" ] || die "usr/bin/node not found in $deb"
        mkdir -p "$(dirname "$2")"
        cp "$node_src" "$2"
        chmod +x "$2"
    else
        local lib_src
        lib_src="$(find "$work" -type d -name lib -path '*usr/lib' | head -n 1)"
        [ -n "$lib_src" ] || die "usr/lib not found in $deb"
        mkdir -p "$3"
        # Regular files first.
        find "$lib_src" -maxdepth 1 -type f -name '*.so*' -exec cp {} "$3/" \;
        # SONAME symlinks (libfoo.so.X -> libfoo.so.X.Y.Z) are standard in .debs,
        # but APK assets cannot hold symlinks: materialize each link's target
        # content under the link's name (this is the name DT_NEEDED references).
        local link
        while IFS= read -r link; do
            [ -n "$link" ] || continue
            [ -e "$link" ] || die "Dangling symlink in $deb: $(basename "$link")"
            cp -L "$link" "$3/"
        done < <(find "$lib_src" -maxdepth 1 -type l -name '*.so*')
    fi
    trap - RETURN
    rm -rf "$work"
}

# ---------------------------------------------------------------------------
# ELF validation (the "this can actually execute on Android" gate)
# ---------------------------------------------------------------------------
needed_libs() { # $1=elf -> NEEDED entries, one per line
    "$READELF_BIN" -d "$1" 2>/dev/null | grep -o '\[.*\.so[^]]*\]' | tr -d '[]'
}

elf_machine() { # $1=elf -> Machine string
    "$READELF_BIN" -h "$1" 2>/dev/null | grep 'Machine:' | sed 's/.*Machine: *//'
}

elf_interp() { # $1=elf -> interpreter path (empty for .so / static binaries)
    # NOTE: match the "[Requesting program interpreter: ...]" line directly.
    # Grabbing "the line after INTERP" is wrong: GNU readelf puts the flags
    # line between the INTERP header and the path line.
    "$READELF_BIN" -l "$1" 2>/dev/null | sed -n 's/.*Requesting program interpreter: \([^]]*\).*/\1/p' | head -n 1
}

# Validate one provisioned runtime dir. Returns nonzero with diagnostics on failure.
validate_runtime() { # $1=abi-tag $2=runtime-dir
    local abi="$1" dir="$2" info termux_arch want_machine want_interp
    info="$(abi_info "$abi")" || { echo "unknown ABI tag: $abi" >&2; return 1; }
    termux_arch="${info%%|*}"; want_machine="$(echo "$info" | cut -d'|' -f2)"; want_interp="$(echo "$info" | cut -d'|' -f3)"

    local node="$dir/node" libdir="$dir/lib" fail=0
    [ -f "$node" ]   || { echo "missing $node" >&2; return 1; }
    [ -d "$libdir" ] || { echo "missing $libdir" >&2; return 1; }

    local machine interp
    machine="$(elf_machine "$node")"
    interp="$(elf_interp "$node")"
    case "$machine" in
        *"$want_machine"*) ;;
        *) echo "$node: wrong architecture (got '$machine', want '*$want_machine')" >&2; fail=1 ;;
    esac
    if [ "$interp" != "$want_interp" ]; then
        echo "$node: wrong interpreter (got '${interp:-<none>}', want '$want_interp'). A Linux (musl/glibc) binary can NEVER run on Android." >&2
        fail=1
    fi

    # Every bundled .so must match the ABI too (catches index/arch mix-ups).
    local so somachine
    for so in "$libdir"/*.so*; do
        [ -e "$so" ] || continue
        somachine="$(elf_machine "$so")"
        case "$somachine" in
            *"$want_machine"*) ;;
            *) echo "$so: wrong architecture (got '$somachine', want '*$want_machine')" >&2; fail=1 ;;
        esac
    done

    # Every DT_NEEDED of node + bundled libs must resolve: bundled or system.
    local needed lib
    for elf in "$node" "$libdir"/*.so*; do
        [ -e "$elf" ] || continue
        while IFS= read -r needed; do
            [ -n "$needed" ] || continue
            if [ -f "$libdir/$needed" ]; then
                continue
            fi
            case " $SYSTEM_LIBS " in
                *" $needed "*) continue ;;
            esac
            echo "$elf: NEEDED $needed is neither bundled in $libdir nor a system lib. Add its Termux package to DEP_PKGS." >&2
            fail=1
        done < <(needed_libs "$elf")
    done
    return "$fail"
}

# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------
json_escape() { # minimal escaper for our controlled values
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

provision_abi() { # $1=abi-tag $2=out-dir $3=tmpdir $4=nodejs-pin $5=skip-elf $6...=repos
    local abi="$1" out="$2" tmpdir="$3" pin="$4" skip_elf="$5"; shift 5
    local info termux_arch
    info="$(abi_info "$abi")" || die "Unknown ABI tag: $abi (want arm64,armv7,x64,x86)"
    termux_arch="${info%%|*}"

    log "Provisioning runtime for $abi (Termux arch $termux_arch)..."
    local fetched repo_root index_file
    fetched="$(fetch_index "$termux_arch" "$tmpdir" "$@")"
    repo_root="${fetched%% *}"; index_file="${fetched##* }"

    local rdir="$out/$abi" node_version="" entry file sha ver deb
    mkdir -p "$rdir/lib"
    for pkg in $DEP_PKGS; do
        if [ "$pkg" = "nodejs" ]; then
            entry="$(parse_pkg "$index_file" "$pkg" "$pin")" \
                || die "nodejs${pin:+ version $pin} not found in $termux_arch index"
        else
            entry="$(parse_pkg "$index_file" "$pkg")" \
                || die "Dependency package '$pkg' not found in $termux_arch index (recipe drift?)"
        fi
        file="${entry%%|*}"; sha="$(echo "$entry" | cut -d'|' -f2)"; ver="$(echo "$entry" | cut -d'|' -f3)"
        [ -n "$file" ] && [ -n "$sha" ] || die "Incomplete index entry for $pkg ($termux_arch)"
        deb="$tmpdir/$(basename "$file")"
        log "  $pkg $ver"
        fetch_url "$repo_root/$file" "$deb"
        [ "$(sha256_of "$deb")" = "$sha" ] \
            || die "SHA-256 mismatch for $file (expected $sha)"
        if [ "$pkg" = "nodejs" ]; then
            node_version="$ver"
            extract_deb "$deb" "$rdir/node" "$rdir/lib" bin
        else
            extract_deb "$deb" "$rdir/node" "$rdir/lib" lib
        fi
        rm -f "$deb"
    done

    if [ "$skip_elf" = "yes" ]; then
        log "  WARNING: ELF validation skipped (--skip-elf-check)"
    else
        command -v "$READELF_BIN" >/dev/null 2>&1 \
            || die "readelf not found ($READELF_BIN). Install binutils or pass --skip-elf-check (not recommended)."
        validate_runtime "$abi" "$rdir" || die "Runtime validation failed for $abi"
        log "  ELF validation passed ($(du -sh "$rdir" | cut -f1))"
    fi
    echo "$node_version"
}

write_manifest() { # $1=out-dir $2=repo-list $3=node-version $4=abi-list
    local out="$1" repos="$2" nver="$3" abis="$4" abi first=1
    {
        echo "{"
        echo "  \"generated_utc\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
        echo "  \"source\": \"Termux APT (nodejs + recipe dependencies)\","
        echo "  \"repos\": \"$(json_escape "$repos")\","
        echo "  \"nodejs_version\": \"$(json_escape "$nver")\","
        echo "  \"abis\": {"
        for abi in $abis; do
            local node="$out/$abi/node"
            [ "$first" = "1" ] && first=0 || echo ","
            printf '    "%s": {"node_sha256": "%s", "libs": [' "$abi" "$(sha256_of "$node")"
            local lfirst=1 lib
            for lib in "$out/$abi"/lib/*.so*; do
                [ -e "$lib" ] || continue
                [ "$lfirst" = "1" ] && lfirst=0 || printf ", "
                printf '"%s"' "$(basename "$lib")"
            done
            printf ']}'
        done
        echo ""
        echo "  }"
        echo "}"
    } > "$out/runtime-manifest.json"
    log "Wrote $out/runtime-manifest.json"
}

usage() {
    sed -n '2,/^#$/p' "$0" | grep '^#' | sed 's/^# \?//'
}

main() {
    local out="" abis="arm64,armv7,x64" pin="" skip_elf="no"
    local -a repos=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --out)            out="$2"; shift 2 ;;
            --abis)           abis="$2"; shift 2 ;;
            --repo)           repos+=("$2"); shift 2 ;;
            --nodejs-version) pin="$2"; shift 2 ;;
            --skip-elf-check) skip_elf="yes"; shift ;;
            --self-test)      self_test; exit $? ;;
            -h|--help)        usage; exit 0 ;;
            *)                die "Unknown argument: $1 (see --help)" ;;
        esac
    done
    [ -n "$out" ] || die "--out DIR is required"
    [ "${#repos[@]}" -gt 0 ] || repos=("${DEFAULT_REPOS[@]}")

    for cmd in curl ar tar; do
        command -v "$cmd" >/dev/null 2>&1 || die "Required tool missing: $cmd"
    done

    local abi_list node_version="" tmpdir
    abi_list="$(echo "$abis" | tr ',' ' ')"
    tmpdir="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmpdir'" EXIT
    for abi in $abi_list; do
        node_version="$(provision_abi "$abi" "$out" "$tmpdir" "$pin" "$skip_elf" "${repos[@]}")"
    done
    write_manifest "$out" "${repos[*]}" "$node_version" "$abi_list"
    log "Done. Total: $(du -sh "$out" | cut -f1)"
}

# ---------------------------------------------------------------------------
# Offline self-test (no network): exercises parsing, .deb handling, layout,
# hash verification, and ELF-validation logic via a readelf shim.
# ---------------------------------------------------------------------------
self_test() {
    local tdir passed=0 failed=0
    tdir="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tdir'" EXIT

    pass() { passed=$((passed+1)); echo "PASS: $1"; }
    fail() { failed=$((failed+1)); echo "FAIL: $1"; }

    # -- fixture 1: minimal fake .deb factory (real ar archive, real data.tar.xz) --
    make_fake_deb() { # $1=out.deb $2=kind (node|lib)
        local d="$tdir/debbuild" pkg="$tdir/debbuild-pkg"
        rm -rf "$d" "$pkg"; mkdir -p "$d" "$pkg/data/data/com.termux/files/usr"
        echo "2.0" > "$d/debian-binary"
        mkdir -p "$d/control" && echo "Package: fake" > "$d/control/control"
        ( cd "$d/control" && tar -czf "$d/control.tar.gz" control )
        if [ "$2" = "node" ]; then
            mkdir -p "$pkg/data/data/com.termux/files/usr/bin"
            echo "fake-node-binary" > "$pkg/data/data/com.termux/files/usr/bin/node"
        else
            mkdir -p "$pkg/data/data/com.termux/files/usr/lib"
            echo "fake-lib" > "$pkg/data/data/com.termux/files/usr/lib/libc++_shared.so"
            # SONAME-style layout: versioned real file + symlink under the SONAME.
            echo "soname-target" > "$pkg/data/data/com.termux/files/usr/lib/libbar.so.1.2.3"
            ln -s libbar.so.1.2.3 "$pkg/data/data/com.termux/files/usr/lib/libbar.so.1"
        fi
        ( cd "$pkg" && tar -cJf "$d/data.tar.xz" data )
        ( cd "$d" && ar rcs "$1" debian-binary control.tar.gz data.tar.xz )
    }

    # -- fixture 2: fake repo with Packages index over file:// --
    local repo="$tdir/repo" pool="$tdir/repo/pool"
    mkdir -p "$pool" "$repo/dists/stable/main/binary-aarch64"
    local pkgs_file="$repo/dists/stable/main/binary-aarch64/Packages"
    : > "$pkgs_file"
    local pkg deb sha
    for pkg in $DEP_PKGS; do
        deb="$pool/${pkg}_1.0_aarch64.deb"
        if [ "$pkg" = "nodejs" ]; then make_fake_deb "$deb" node; else make_fake_deb "$deb" lib; fi
        sha="$(sha256_of "$deb")"
        {
            echo "Package: $pkg"
            echo "Version: 1.0"
            echo "Filename: pool/${pkg}_1.0_aarch64.deb"
            echo "SHA256: $sha"
            echo ""
        } >> "$pkgs_file"
    done

    # -- test 1: full offline provision (ELF check skipped: fixtures are not ELF) --
    if "$0" --out "$tdir/out" --abis arm64 --repo "file://$repo" --skip-elf-check >/dev/null 2>&1; then
        [ -f "$tdir/out/arm64/node" ] && [ "$(cat "$tdir/out/arm64/node")" = "fake-node-binary" ] \
            && pass "node binary staged at out/<abi>/node" \
            || fail "node binary staged at out/<abi>/node"
        [ -f "$tdir/out/arm64/lib/libc++_shared.so" ] \
            && pass "dep libs staged at out/<abi>/lib" \
            || fail "dep libs staged at out/<abi>/lib"
        [ -f "$tdir/out/arm64/lib/libbar.so.1" ] \
            && [ "$(cat "$tdir/out/arm64/lib/libbar.so.1")" = "soname-target" ] \
            && [ ! -L "$tdir/out/arm64/lib/libbar.so.1" ] \
            && pass "SONAME symlinks materialized as real files" \
            || fail "SONAME symlinks materialized as real files"
        grep -q '"nodejs_version": "1.0"' "$tdir/out/runtime-manifest.json" \
            && pass "manifest records nodejs version" \
            || fail "manifest records nodejs version"
    else
        fail "offline provision run (exit $?)"
    fi

    # -- test 2: version pinning (runs before test 3 corrupts the pool) --
    if "$0" --out "$tdir/out3" --abis arm64 --repo "file://$repo" --nodejs-version 1.0 --skip-elf-check >/dev/null 2>&1 \
       && ! "$0" --out "$tdir/out4" --abis arm64 --repo "file://$repo" --nodejs-version 9.9 --skip-elf-check >/dev/null 2>&1; then
        pass "nodejs version pin (match ok / mismatch fails)"
    else
        fail "nodejs version pin (match ok / mismatch fails)"
    fi

    # -- test 3: hash mismatch is detected --
    echo "corrupt" >> "$pool/libc++_1.0_aarch64.deb"
    if "$0" --out "$tdir/out2" --abis arm64 --repo "file://$repo" --skip-elf-check >/dev/null 2>&1; then
        fail "corrupted .deb is rejected"
    else
        pass "corrupted .deb is rejected"
    fi

    # -- test 4: ELF validation logic via readelf shim --
    mkdir -p "$tdir/shim"
    # Shim behavior is keyed by the path under test (directory name).
    cat > "$tdir/shim/readelf" << 'SHIM'
#!/usr/bin/env bash
f="$2"
is() { case "$f" in *"$1"*) return 0;; *) return 1;; esac; }
case "$1" in
    -h) if is linuxcase; then echo "  Machine: Advanced Micro Devices X86-64";
        elif is armcase; then echo "  Machine: ARM";
        else echo "  Machine: AArch64"; fi ;;
    -l) if is linuxcase; then echo "  INTERP         0x318 0x318 0x318"; echo "                 0x1c 0x1c  R      0x1"; echo "      [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]";
        elif is armcase; then echo "  INTERP         0x134 0x134 0x134"; echo "                 0x13 0x13  R      0x1"; echo "      [Requesting program interpreter: /system/bin/linker]";
        elif is soname; then echo "  no program headers";
        else echo "  INTERP         0x318 0x318 0x318"; echo "                 0x1c 0x1c  R      0x1"; echo "      [Requesting program interpreter: /system/bin/linker64]"; fi ;;
    -d) if is missingcase; then printf ' (NEEDED) Shared library: [libunbundled.so]\n (NEEDED) Shared library: [libc.so]\n';
        elif is soname; then printf ' (NEEDED) Shared library: [libc.so]\n';
        else printf ' (NEEDED) Shared library: [libc++_shared.so]\n (NEEDED) Shared library: [libc.so]\n'; fi ;;
esac
SHIM
    chmod +x "$tdir/shim/readelf"
    export READELF_BIN="$tdir/shim/readelf"

    mkcase() { # $1=name (dir contains node + lib/)
        mkdir -p "$tdir/$1/lib"; : > "$tdir/$1/node"; : > "$tdir/$1/lib/libc++_shared.so"
    }
    mkcase goodcase; mkcase linuxcase; mkcase missingcase; mkcase armcase
    # armcase dir holds armv7-tagged content; linuxcase holds a linux binary.
    validate_runtime arm64 "$tdir/goodcase" >/dev/null 2>&1 \
        && pass "ELF validation accepts correct Android runtime" \
        || fail "ELF validation accepts correct Android runtime"
    validate_runtime armv7 "$tdir/armcase" >/dev/null 2>&1 \
        && pass "ELF validation accepts 32-bit ARM runtime" \
        || fail "ELF validation accepts 32-bit ARM runtime"
    ! validate_runtime arm64 "$tdir/linuxcase" >/dev/null 2>&1 \
        && pass "ELF validation rejects Linux (glibc) binary" \
        || fail "ELF validation rejects Linux (glibc) binary"
    ! validate_runtime x64 "$tdir/goodcase" >/dev/null 2>&1 \
        && pass "ELF validation rejects wrong machine type" \
        || fail "ELF validation rejects wrong machine type"
    ! validate_runtime arm64 "$tdir/missingcase" >/dev/null 2>&1 \
        && pass "ELF validation rejects unbundled NEEDED lib" \
        || fail "ELF validation rejects unbundled NEEDED lib"

    # -- test 5: arch mapping rejects unknown tags --
    ! abi_info mips >/dev/null 2>&1 \
        && pass "unknown ABI tag rejected" \
        || fail "unknown ABI tag rejected"

    # -- test 6: dangling symlinks in a .deb are rejected, not silently skipped --
    local dangle="$tdir/dangle-pkg"
    rm -rf "$dangle" "$tdir/dangle-deb"
    mkdir -p "$dangle/data/data/com.termux/files/usr/lib" "$tdir/dangle-deb/control"
    ln -s does-not-exist.so "$dangle/data/data/com.termux/files/usr/lib/libdangle.so.1"
    echo "2.0" > "$tdir/dangle-deb/debian-binary"
    echo "Package: fake" > "$tdir/dangle-deb/control/control"
    ( cd "$dangle" && tar -cJf "$tdir/dangle-deb/data.tar.xz" data )
    ( cd "$tdir/dangle-deb/control" && tar -czf "$tdir/dangle-deb/control.tar.gz" control )
    ( cd "$tdir/dangle-deb" && ar rcs "$tdir/dangle.deb" debian-binary control.tar.gz data.tar.xz )
    if ( extract_deb "$tdir/dangle.deb" "$tdir/dangle-node" "$tdir/dangle-lib" lib ) >/dev/null 2>&1; then
        fail "dangling symlink in .deb is rejected"
    else
        pass "dangling symlink in .deb is rejected"
    fi

    echo "self-test: $passed passed, $failed failed"
    [ "$failed" = "0" ]
}

# Allow sourcing for tests without executing main.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
