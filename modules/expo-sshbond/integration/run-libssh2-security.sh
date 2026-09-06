#!/usr/bin/env bash
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="${SSHBOND_LIBSSH2_DIR:-$MODULE_DIR/ios/vendor/libssh2}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
# The shipped config describes Darwin. Linux lacks memset_s; the vendored
# fallback is used here. This does not compile or execute the Swift bridge.
sed '/#define HAVE_MEMSET_S/d' "$VENDOR/libssh2_config.h" > "$WORK_DIR/libssh2_config.h"
sources=()
for source in "$VENDOR"/src/*.c; do
  case "$(basename "$source")" in agent_win.c|blowfish.c|openssl.c) continue;; esac
  sources+=("$source")
done
gcc -O1 -g -no-pie -fsanitize=address,undefined -DHAVE_CONFIG_H -DLIBSSH2_OPENSSL \
  -I"$WORK_DIR" -I"$VENDOR/include" -I"$VENDOR/src" \
  "${sources[@]}" "$MODULE_DIR/integration/libssh2-security.c" \
  -lssl -lcrypto -o "$WORK_DIR/libssh2-security"
timeout 10s "$WORK_DIR/libssh2-security"
