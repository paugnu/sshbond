# Architecture & Technical Design: SSHBond — OpenSSH Client

**Document ID**: `docs/architecture.md`  
**Application Name**: SSHBond — OpenSSH Client  
**Platforms**: iOS, Android (React Native, Expo, TypeScript)

---

## 1. Core Principles

1. **OpenSSH Mental Model**: Configuration files and parameters follow the exact grammar and semantics of OpenSSH `~/.ssh/config`. No proprietary lock-in.
2. **Local-First & Zero-Telemetry**: Full functionality runs locally on the device without registration, accounts, or telemetry. Private keys never leave the device.
3. **Progressive Disclosure**: Clean, minimalist, and approachable UI for simple `host/user/auth` connections, while exposing all OpenSSH parameters in structured collapsible sections or a raw config editor.
4. **Resilient Terminal Experience**: High-fidelity terminal emulator (`xterm.js`) supporting ANSI colors, UTF-8, cursor addressing, ncurses apps (`htop`, `vim`, `tmux`), and a mobile keyboard accessory toolbar.
5. **Decoupled Engine Layer**: Clear separation between UI components, OpenSSH domain models, secure keystores, and the underlying SSH transport engine.

---

## 2. System Architecture

```
src/
├── app/                        # Expo Router navigation & screen routes
│   ├── _layout.tsx             # Root layout: biometric gate + ThemeProvider
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Bottom tab bar (Hosts, Sessions, Keys, Settings)
│   │   ├── index.tsx           # Hosts (search, groups, tags, quick connect)
│   │   ├── sessions.tsx        # Active sessions + declared port forwards
│   │   ├── keys.tsx            # SSH identity management
│   │   └── settings.tsx        # App, terminal, known-hosts and config settings
│   ├── host/
│   │   ├── [id].tsx            # Host editor (form & raw config modes)
│   │   └── new.tsx             # New host
│   └── terminal/
│       └── [sessionId].tsx     # Fullscreen interactive terminal
│
├── domain/models/
│   └── sshConfig.ts            # SSHHost, SSHIdentity, SSHGroup, KnownHost, ResolvedSSHConfig
│
├── services/
│   ├── crypto/
│   │   ├── ed25519Bootstrap.ts # Installs pure-JS SHA-512 + platform CSPRNG into @noble/ed25519
│   │   └── randomBytes.ts      # expo-crypto CSPRNG wrapper
│   ├── ssh/
│   │   ├── SSHClient.ts        # Connect orchestration: credentials, host key policy, history
│   │   ├── SSHConnection.ts    # Session lifecycle, listeners, idempotent close
│   │   ├── SSHTunnelManager.ts # Declared port forwards per session
│   │   ├── config/
│   │   │   ├── SSHConfigParser.ts     # OpenSSH grammar parser
│   │   │   ├── SSHConfigResolver.ts   # Inheritance & wildcard matching
│   │   │   └── SSHConfigSerializer.ts # Model to OpenSSH text
│   │   ├── keys/
│   │   │   ├── SSHKeyManager.ts       # Ed25519 keygen, key parsing, fingerprints
│   │   │   └── sshWire.ts             # RFC 4251 encoding, base64/utf8 without btoa
│   │   ├── hosts/
│   │   │   └── SSHKnownHosts.ts       # known_hosts storage + StrictHostKeyChecking policy
│   │   └── native/
│   │       ├── NativeSSHBridge.ts     # Native module contract & event wiring
│   │       └── MockSSHBridge.ts       # Simulator for Jest, web and Expo Go
│   ├── secureStorage/
│   │   └── SecureStorageService.ts    # Keychain/Keystore + biometrics
│   └── persistence/
│       ├── JsonFileStore.ts           # Atomic JSON documents (metadata tier)
│       └── HostStorageService.ts      # Hosts, identities, groups, known hosts, history, settings
│
├── features/
│   ├── hosts/                  # HostCard, HostEditor, GroupHeader, QuickConnectBar
│   ├── connect/                # useConnectionPrompts: host key & credential dialogs
│   ├── terminal/               # TerminalView (bundled xterm.js), toolbar, paste modal, SessionManager
│   ├── keys/                   # KeyCard, GenerateKeyModal, ImportKeyModal
│   └── settings/               # Config import/export modal
│
├── theme/
│   ├── colors.ts               # Neutral & terminal palettes (Nord, Dracula, Solarized)
│   └── ThemeContext.tsx        # Light/dark/system provider
│
└── utils/
    ├── logger.ts               # Redacting diagnostic logger (no remote sink)
    └── connectionString.ts     # user@host:port parsing, IPv6-aware
```

---

## 3. OpenSSH Resolution Pipeline

OpenSSH uses a strict first-match-wins rule for configuration directives:

```
[Raw ~/.ssh/config or Form Input]
                 │
                 ▼
     [SSHConfigParser.ts]
    (Tokenizes blocks, directives, quotes, comments)
                 │
                 ▼
     [SSHConfigResolver.ts]
    1. Evaluates target host alias (e.g. "prod-db")
    2. Matches against wildcards (*, *.prod, !dev)
    3. Merges directives with first-match-wins semantics
                 │
                 ▼
     [ResolvedSSHConfig]
    (hostName, port, user, identity, proxyJump, keepAlive, etc.)
                 │
                 ▼
       [SSHProxyJump.resolveChain()]
    Expands the ProxyJump directive into the hops it names, each
    resolved like any other host, in the order they are traversed
                 │
                 ▼
       [SSHClient.connect()]
```

---

## 4. Security & Storage Model

1. **Metadata Tier (JSON documents in the app's private documents directory)**:
   - Hosts, groups, tags, UI preferences, known host fingerprints, connection history.
   - Contains NO private keys, passwords, or secrets.
   - Deliberately not SecureStore: the keychain/keystore is built for small
     secrets, and Android's backing store becomes unreliable above roughly 2 KB
     per value — a size a realistic host list passes quickly. Writes go through a
     temp file and a rename so an interrupted write cannot truncate the document.
   - Data written by builds that used SecureStore for this tier is migrated on
     first launch and removed from the keychain.

2. **Secure Credentials Tier (iOS Keychain / Android KeyStore)**:
   - Private key files, passphrases, stored passwords.
   - Encrypted with hardware-backed keys, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
   - Per-key biometric gating (`requireAuthentication`) is opt-in at generation or
     import time; `expo-local-authentication` also gates app launch when enabled.

3. **In-Memory Volatile Tier**:
   - Active PTY buffers and the decrypted key material handed to the native engine
     at authentication time.

### 4.1. Host Key Verification

Verification happens in `SSHClient.connect` before any credential is sent, and is
not optional — a build with no way to prompt the user refuses to connect to an
unverified host rather than proceeding.

| Policy | Unknown host | Changed key |
| :--- | :--- | :--- |
| `ask` (default) | Prompt with the fingerprint | Prompt, flagged as a mismatch |
| `accept-new` | Trust on first use | **Refuse** |
| `yes` | Refuse | **Refuse** |
| `no` | Trust on first use | **Refuse** |

A changed host key is never accepted without explicit confirmation, including
under `no`. Keys are matched on host, port *and* algorithm, so a server offering
an additional key type reads as a new key rather than as an attack.

### 4.2. Key Generation Boundaries

Ed25519 keys are generated on device. `@noble/ed25519` delegates hashing to
WebCrypto and randomness to `crypto.getRandomValues`, neither of which exists on
Hermes, so `services/crypto/ed25519Bootstrap.ts` installs pure-JS SHA-512 and the
platform CSPRNG before any key operation.

RSA and ECDSA generation is refused with an explicit error directing the user to
`ssh-keygen`. Import supports all three, and recovers the public key and
fingerprint from an unencrypted private key rather than trusting a pasted value.

Generated keys are asserted against the real `ssh-keygen` in the test suite: both
that it can load the private key and that it reports the same SHA256 fingerprint.
