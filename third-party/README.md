# Upstream notices bundled with SSHBond

Run `npm run build:license-notices` after `npm ci` to regenerate the offline
license viewer. The generator includes installed production-lock packages
(including build tooling), plus xterm and its fit addon which are embedded in
the terminal. Exact LICENSE / NOTICE / COPYING files are copied unchanged.
The generated data is committed so cloud builds do not depend on local inventory.

Additional source texts:

- OpenSSL 3.6.2: https://github.com/openssl/openssl/blob/openssl-3.6.2/LICENSE.txt
- JSch 2.28.7: https://github.com/mwiede/jsch/blob/jsch-2.28.7/LICENSE.txt
- Bouncy Castle 1.85.2: https://www.bouncycastle.org/licence.html (retrieved 2026-09-06).
- libssh2 1.11.1: the vendored LICENSE in modules/expo-sshbond/ios/vendor/libssh2.
- Expo SDK 54: https://github.com/expo/expo/blob/sdk-54/LICENSE
- React Native 0.81.5: https://github.com/facebook/react-native/blob/v0.81.5/LICENSE
- Metro 0.83.3: https://github.com/facebook/metro/blob/v0.83.3/LICENSE
- Android-* files: original notices extracted from SSHBond Android 1.0.0 (4),
  SHA-256 827b304d322140893d23db640e20048e2a35d9fd33f651d463f370277f120f62.

This is an attribution inventory, not a completed audit of every native binary.
The generator writes missing installed-package license files to
`output/store/license-notices-missing.json` (23 entries at this revision).
Some are build tools; remaining runtime omissions and the final Gradle/CocoaPods
transitive dependency notices must be resolved before public release. Recheck
native versions and notices whenever rebuilding with different dependencies.
