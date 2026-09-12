#!/bin/bash
set -euo pipefail
[[ "${SSHBOND_STORE_SCREENSHOTS:-}" == 1 ]] || exit 0
app=$(find "$PWD/ios/build/Build/Products" -maxdepth 2 -name SSHBond.app -type d | head -n 1)
[[ -n "$app" ]]
out="$PWD/output/release-evidence"
mkdir -p "$out"
xcrun simctl list devices available -j > "$out/simulator-devices.json"
python3 - "$out/simulator-devices.json" > "$out/capture-devices.tsv" <<'PY'
import json,sys
devices=[x for group in json.load(open(sys.argv[1]))['devices'].values() for x in group]
for label,match in [('iphone','Pro Max'),('ipad','13-inch')]:
    d=next(x for x in devices if match in x['name'] and ('iPhone' if label=='iphone' else 'iPad') in x['name'])
    print(label+'\t'+d['udid'])
PY
while IFS=$'\t' read -r label udid; do
  xcrun simctl boot "$udid" || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl ui "$udid" appearance dark
  xcrun simctl status_bar "$udid" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
  xcrun simctl install "$udid" "$app"
  xcrun simctl launch "$udid" com.sshbond.client
  sleep 8
  xcrun simctl io "$udid" screenshot "$out/$label-hosts.png"
  # simctl openurl shows an OS confirmation dialog; additional screens need
  # UI-driven navigation and visual verification before use in the store.
done < "$out/capture-devices.tsv"
