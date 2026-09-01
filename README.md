# SSHBond — OpenSSH Client for iOS & Android

A local-first SSH client built on React Native + Expo, with an OpenSSH mental model:
hosts are `~/.ssh/config` blocks, not proprietary profiles.

- **Nothing leaves the device.** No accounts, no telemetry, no remote log sink. The
  terminal emulator is bundled into the app rather than fetched from a CDN, so a
  session to a machine on your LAN works with no internet at all.
- **Keys stay in hardware.** Private keys live in the iOS Keychain / Android
  Keystore and can be gated behind Face ID or a fingerprint. They are never written
  to a file, a log, or an export.
- **Host keys are verified.** `StrictHostKeyChecking` is honoured on every
  connection, and a changed host key is never accepted silently.

---

## Getting started

```bash
npm install
npm start          # Expo dev server -- simulator engine only
npm run android    # development build with the real SSH engine
```

`npm start` (Expo Go) runs against the **simulator engine**: the whole app works,
but no traffic reaches the network. Real SSH needs the development build, and is
Android-only today — see below.

### Verifying a change

```bash
npm run verify     # typecheck + lint + tests
```

The key tests shell out to the system `ssh-keygen` and assert that keys SSHBond
generates are byte-for-byte acceptable to OpenSSH. They are skipped automatically
where `ssh-keygen` is unavailable.

### Regenerating assets

Two source files are generated and committed:

```bash
npm run build:terminal-assets   # src/features/terminal/xtermAssets.ts (inlined xterm.js)
npm run build:app-icons         # assets/*.png
```

Re-run the first after bumping the `xterm` dependency.

---

## The SSH engine

Application code talks only to `SSHClient` / `ISSHConnection`. Underneath there
are two implementations:

| | When it runs | What it does |
|---|---|---|
| `expo-sshbond` (Android) | An Android development build | Real SSH over [mwiede/jsch](https://github.com/mwiede/jsch): Ed25519, curve25519, ChaCha20-Poly1305, full PTY, `-L`/`-R`/`-D` forwarding, `ProxyJump` chains |
| `expo-sshbond` (iOS) | An iOS development build | Real SSH over vendored [libssh2](https://libssh2.org) 1.11.1 on OpenSSL 3: Ed25519, curve25519, full PTY. Forwarding and `ProxyJump` are refused, not faked |
| `MockSSHBridge` | Jest, web, Expo Go, and iOS | A simulator. It runs the full lifecycle, host key verification included, and says plainly in its banner that nothing is reaching the network |

### Real SSH connections today

**Only from a development build.** Expo Go cannot load a custom native module,
so `npm start` alone always gives you the simulator, on either platform.

```bash
npm run android          # prebuild + compile + install a dev build
npm run ios              # the same, on a machine with Xcode
```

Android requires the Android SDK (platform 34, build-tools 34) and **JDK 17**.

Without a Mac, an iOS development build is made in the cloud, which needs an
Apple Developer Program membership for device provisioning:

```bash
eas device:create                                  # register the iPhone
eas build --profile development --platform ios     # signed dev client
```

Also missing from the Android engine, and refused rather than faked: agent
forwarding and `ProxyCommand`. See `docs/ssh-engine.md` §3.7.

### Testing the engine

`SSHBondSession` has no Android or Expo dependency, so the hard part — the
handshake, host key gating, PTY and stream lifetime — is verified on a plain JVM
against a real OpenSSH server:

```bash
modules/expo-sshbond/integration/run.sh
```

It starts a throwaway `sshd`, authenticates with a key produced by SSHBond's own
key manager, and asserts on the events the engine emits — including that the
handshake really does block until the host key is approved, and that refusing it
aborts before authentication. Requires `kotlinc`, `sshd` and JDK 17+.

## How a connection is made

```
Host (saved model)  ──►  SSHConfigResolver  ──►  ResolvedSSHConfig
                          (wildcard inheritance,
                           first-match-wins)
                                                        │
                                                        ▼
                                              SSHClient.connect()
                                                        │
                          ┌─────────────────────────────┤
                          ▼                             ▼
                  resolve credentials          verify host key
                  (Keychain / prompt)          (known_hosts + policy)
                                                        │
                                                        ▼
                                                 native engine
```

The host key is checked **before** any credential is sent. A key that cannot be
verified — and that the user is not asked about, or declines — aborts the
connection rather than continuing.

### Port forwarding

`LocalForward`, `RemoteForward` and `DynamicForward` are honoured by the Android
engine. `-D` is a SOCKS5/SOCKS4a proxy bound, by default, to loopback only.

A forward that cannot be established -- a port already in use, a target the
server refuses to reach -- does not take the session down, as with `ssh` itself.
It is reported against its own tunnel in the sessions list, with the reason. A
tunnel is only ever shown as active once the engine confirms it is listening,
and a rule written with port `0` shows the port that was actually allocated.

Rules can be written in the host editor or imported from a `~/.ssh/config`;
either way the same parser reads them, so what the form accepts and what a
config file means cannot drift apart.

### ProxyJump

`ProxyJump gateway`, `jump@gateway:2222`, and `bastion1,bastion2` all work, and
a jump host may itself sit behind another one. A hop naming a saved host uses
that host's settings; an unsaved one borrows the target's key, which is what
makes `ProxyJump user@host` work without saving the bastion first.

Every machine in the chain is verified separately -- against its own
`known_hosts` entry and its own `StrictHostKeyChecking` -- and none is
authenticated before its host key has been. A chain that cannot be resolved, or
that loops back on itself, refuses to connect rather than quietly opening a
direct connection to a host meant to be reachable only through a bastion.

### StrictHostKeyChecking

| Policy | Unknown host | Changed key |
|---|---|---|
| `ask` (default) | prompt | prompt, with an explicit warning |
| `accept-new` | trust silently | **refuse** |
| `yes` | refuse | **refuse** |
| `no` | trust silently | **refuse** |

A changed host key is never auto-accepted, including under `no`. That case is the
signature of a man-in-the-middle, and OpenSSH's `no` was never meant to cover it.

---

## Storage tiers

| Tier | Backed by | Holds |
|---|---|---|
| Secrets | `expo-secure-store` (Keychain / Keystore) | Private keys, passphrases, saved passwords |
| Metadata | JSON files in the app's private documents directory | Hosts, groups, known hosts, history, settings |

Metadata is deliberately **not** in SecureStore: Android's backing store is
unreliable above roughly 2 KB per value, which a realistic host list exceeds. Data
written by earlier builds is migrated out of the keychain automatically on first
launch.

That 2 KB ceiling applies to secrets too — an imported 4096-bit RSA key is past
it — so a secret that does not fit is split across numbered keychain entries and
rejoined on read. Key material never leaves the keychain to make this work. Two
consequences worth knowing:

- A missing part fails the read outright. Half a private key would be reported
  by the SSH engine as a parse error, sending the user to look at the key they
  pasted rather than at their storage.
- A **biometric-gated** secret large enough to be split prompts once per part.
  The keystore authorises one read at a time and offers no way to ask for a
  batch. Ed25519 keys, which SSHBond generates, always fit in one.

---

## Key generation

SSHBond generates **Ed25519** keys on device, using `@noble/ed25519` with pure-JS
SHA-512 and the platform CSPRNG (React Native has no `crypto.subtle`).

RSA and ECDSA are **import-only**. There is no audited pure-JS generator for them
in the dependency set, and emitting a placeholder would hand the user a key no
server will ever accept. Generate those with `ssh-keygen` and import them; import
recovers the real public key and fingerprint from the private key itself.

---

## Layout

```
modules/
└── expo-sshbond/   Native SSH transport (Android: Kotlin + JSch)

src/
├── app/            Expo Router screens (tabs, host editor, terminal)
├── domain/models/  Pure types
├── features/       UI by feature (hosts, terminal, keys, connect, settings)
├── services/
│   ├── crypto/     Ed25519 bootstrap + CSPRNG for React Native
│   ├── ssh/        Client, connection, config parser/resolver/serializer,
│   │               key manager, known hosts, proxy jump chains, tunnels,
│   │               native + mock bridges
│   ├── secureStorage/  Keychain / Keystore + biometrics
│   └── persistence/    Metadata tier
├── theme/          Design tokens, terminal palettes
└── utils/          Redacting logger, connection-string parser
```

See `docs/architecture.md` and `docs/ssh-engine.md` for the detailed design.
