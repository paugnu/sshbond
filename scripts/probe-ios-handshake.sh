#!/bin/bash
set -eu
[[ "${SSHBOND_HANDSHAKE_PROBE:-}" == 1 ]] || exit 0
v="$PWD/modules/expo-sshbond/ios/vendor/libssh2"
w=$(mktemp -d)
framework=$(find "$PWD/ios/Pods" -path '*ios-arm64_x86_64-simulator/OpenSSL.framework' -type d | head -n1)
[[ -n "$framework" ]]
sources=()
for source in "$v"/src/*.c; do case "$(basename "$source")" in agent_win.c|blowfish.c|openssl.c) continue;; esac; sources+=("$source"); done
UDID=$(xcrun simctl list devices available -j | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next(v["udid"] for a in d["devices"].values() for v in a if "iPhone" in v["name"]))')
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
root="$PWD"
cp scripts/handshake-main.swift "$w/main.swift"
cd "$w"
xcrun --sdk iphonesimulator clang -Os -target "$(uname -m)-apple-ios15.1-simulator" -isysroot "$(xcrun --sdk iphonesimulator --show-sdk-path)" -DHAVE_CONFIG_H -DLIBSSH2_OPENSSL -DLIBSSH2DEBUG -I"$v" -I"$v/include" -I"$v/src" -F"$(dirname "$framework")" -c "${sources[@]}"
xcrun --sdk iphonesimulator swiftc -O -D SSHBOND_DIAGNOSTIC -target "$(uname -m)-apple-ios15.1-simulator" -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -I"$v/swiftmodule" -F"$(dirname "$framework")" -framework OpenSSL -Xlinker -rpath -Xlinker "$(dirname "$framework")" "$root/modules/expo-sshbond/ios/SSHBondTypes.swift" "$root/modules/expo-sshbond/ios/SSHBondSession.swift" main.swift *.o -o swift-probe
if [[ -n "${SSHBOND_PROBE_HOST:-}" ]]; then
  xcrun simctl spawn "$UDID" "$w/swift-probe" "$SSHBOND_PROBE_HOST"
fi
# A disposable local OpenSSH server exercises authentication and channel IO.
ssh-keygen -q -t ed25519 -N '' -f "$w/host_key"
ssh-keygen -q -t ed25519 -N '' -f "$w/client_key"
cat > "$w/sshd_config" <<CONFIG
Port 22229
ListenAddress 127.0.0.1
HostKey $w/host_key
PidFile $w/sshd.pid
AuthorizedKeysFile $w/client_key.pub
StrictModes no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
AllowUsers $(whoami)
CONFIG
sudo -n /usr/sbin/sshd -f "$w/sshd_config" -E "$w/sshd.log"
trap 'sudo -n kill "$(cat "$w/sshd.pid")" 2>/dev/null || true' EXIT
fingerprint=$(ssh-keygen -lf "$w/host_key.pub" -E sha256 | awk '{print $2}')
xcrun simctl spawn "$UDID" "$w/swift-probe" 127.0.0.1 22229 "$(whoami)" "$w/client_key" "$fingerprint"
# The build may proceed only after the Swift transport passed.
exit 0
