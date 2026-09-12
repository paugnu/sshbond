"""Include CocoaPods' resolved attribution texts before Metro bundles the app."""
import json
import pathlib
import plistlib

root = pathlib.Path(__file__).resolve().parent.parent
pods = root / 'ios/Pods/Target Support Files/Pods-SSHBond'
source = pods / 'Pods-SSHBond-acknowledgements.plist'
if not source.exists():
    raise SystemExit('Missing CocoaPods acknowledgements; refusing to omit native notices')
entries = json.loads((root / 'src/generated/licenseNotices.json').read_text())
entries = [entry for entry in entries if not entry['name'].startswith('CocoaPods: ')]
data = plistlib.loads(source.read_bytes())
for entry in data['PreferenceSpecifiers']:
    if entry.get('Title') and entry.get('FooterText'):
        entries.append({'name': 'CocoaPods: ' + entry['Title'], 'text': entry['FooterText']})
(root / 'src/generated/licenseNotices.json').write_text(json.dumps(entries))
out = root / 'output/release-evidence'
out.mkdir(parents=True, exist_ok=True)
(out / source.name).write_bytes(source.read_bytes())
(out / 'Podfile.lock').write_bytes((root / 'ios/Podfile.lock').read_bytes())
print(f'Bundled {len(data["PreferenceSpecifiers"])} CocoaPods acknowledgement sections')
