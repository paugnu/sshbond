# Technical Decision Document: Mobile SSH Engine for SSHBond

**Document ID**: `docs/ssh-engine.md`  
**Status**: Accepted / Architecture Baseline  
**Target Platforms**: iOS (15.0+), Android (8.0+ / API 26+)  
**Technology Framework**: React Native 0.74+ / Expo SDK 51+ (Development Builds & Native Modules)

---

## 1. Executive Summary

SSHBond requires an industrial-grade, secure, and standards-compliant OpenSSH implementation capable of running natively on iOS and Android. Mobile environments introduce unique constraints:
- JavaScript execution threads in React Native cannot run raw TCP sockets or execute CPU-intensive cryptographic handshakes at line rate without native bridging.
- Mobile OS lifecycle (backgrounding, Wi-Fi to cellular roaming, sleep states) requires robust socket keep-alive, reconnection management, and PTY resize signaling.
- Private keys and passphrases must be protected using hardware-backed enclaves (iOS Secure Enclave / Keychain, Android KeyStore).

This document evaluates the viable SSH engine approaches, documents security trade-offs, and establishes the SSHBond Native Bridge Abstraction Layer (`ISSHClient` / `ISSHConnection`).

---

## 2. Evaluation Matrix of Mobile SSH Engines

| Criteria | **libssh2 / NMSSH (C / Obj-C / Swift)** | **Citadel / SwiftSSH (Pure Swift)** | **JSch / Apache MINA / BouncyCastle (Android JVM)** | **react-native-ssh / community bridges** | **Pure JS (ssh2 / noble-ed25519 fallback)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **iOS Compatibility** | **Excellent**: Mature C/ObjC framework used by iOS apps. | **Good**: Pure Swift / NIO, modern, but lacks Android counterpart. | **N/A** (Android only) | **Fair**: Often unmaintained, relies on older NMSSH/JSch. | **Limited**: Requires TCP polyfills (react-native-tcp-socket), JS thread latency. |
| **Android Compatibility** | **Good**: Compiled via NDK (CMake). | **N/A** (Apple-only ecosystem) | **Excellent**: Battle-tested in Android enterprise tools. | **Fair**: Often lacks modern cipher suites (Ed25519). | **Limited**: High CPU usage during heavy PTY stream bursts. |
| **Ciphers & Key Types** | **Complete**: Ed25519, RSA (2048/4096), ECDSA (nistp256/384/521), ChaCha20-Poly1305. | **Good**: Ed25519, RSA, ECDSA. | **Complete**: Ed25519 (via BouncyCastle), RSA, ECDSA. | **Variable**: Often missing modern OpenSSH Ed25519 format. | **Complete**: Software crypto via noble-curves / tweetnacl. |
| **Interactive PTY / ncurses** | **Native**: Full PTY allocation (`pty-req`), window-change (`window-change`), VT100/xterm emulation. | **Native**: Supports standard PTY requests. | **Native**: Full PTY stream channel support (`ChannelShell`). | **Basic**: Basic string streaming, often lacks clean resize signals. | **Simulated**: Requires manual PTY state tracking. |
| **ProxyJump / Chaining** | **Supported**: Direct socket/channel forwarding through jump bastion. | **Custom**: Requires custom channel pipelines. | **Supported**: Built-in port forwarding / jump host bridging. | **Rarely Supported**: Missing multi-hop chaining. | **Possible**: Through nested socket streams. |
| **Port Forwarding (-L, -R, -D)**| **Supported**: Direct TCP/IP forwarding channels. | **Partial**: Local forwarding only. | **Supported**: Local, Remote, and SOCKS5 dynamic forwarders. | **Partial / None**: Usually shell-only. | **Supported**: If socket polyfills present. |
| **Expo Dev Build Compatibility** | **High**: Wrappable as an Expo Config Plugin / Native Module (`expo-modules-core`). | **High**: iOS native framework. | **High**: Gradle dependency integration. | **Medium**: Requires manual autolinking patches. | **Universal**: Pure JS runs anywhere. |

---

## 3. Selected Engine Strategy: Hybrid Native Core with Unified TS Abstraction

To avoid single-vendor lock-in and ensure maximum longevity and testability, SSHBond adopts a **3-tier architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    UI & Terminal Layer                      │
│            (xterm.js WebView / Custom Keyboards)            │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│           SSHBond TypeScript Abstraction Layer              │
│  (SSHClient, SSHConnection, SSHConfigResolver, KeyManager)  │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│   Native Platform Module    │ │   Simulator / Fallback      │
│     (expo-sshbond native)   │ │  (Local Shell / Test Bridge)│
│                             │ │                             │
│ • iOS: libssh2 / NMSSH      │ │ • Unit & E2E Test Suite     │
│ • Android: JSch + BCrypt    │ │ • In-Memory Test Harness    │
└─────────────────────────────┘ └─────────────────────────────┘
```

### 3.1. Primary Native Engine

- **Android — implemented.** `modules/expo-sshbond`, an Expo module using
  [mwiede/jsch](https://github.com/mwiede/jsch) 2.28.x.

  The original `com.jcraft:jsch` was abandoned in 2018 and ships neither
  Ed25519, `curve25519-sha256`, nor `rsa-sha2-*`. Since OpenSSH 8.8 disabled
  SHA-1 signatures by default, that version cannot authenticate against a
  current server at all. mwiede's fork is the maintained continuation and
  carries the modern algorithms.

- **iOS — not implemented.** Intended to be libssh2 + OpenSSL via an Expo
  Config Plugin. Until it exists, `expo-module.config.json` declares only the
  `android` platform, so an iOS build still succeeds and simply falls back to
  the simulator bridge.

### 3.2. Module Layout

```
modules/expo-sshbond/
├── expo-module.config.json          # android-only registration
├── index.ts                         # typed JS surface; null when not built in
├── android/
│   ├── build.gradle                 # jsch dependency
│   └── src/main/java/expo/modules/sshbond/
│       ├── SSHBondTypes.kt          # params, events, status constants
│       ├── SSHBondSession.kt        # the SSH engine (no Android imports)
│       ├── SSHPortForwards.kt       # -L / -R forwards and the -D SOCKS proxy
│       └── SSHBondModule.kt         # Expo Modules API binding
├── ios/
│   ├── ExpoSSHBond.podspec          # builds vendored libssh2 against OpenSSL 3
│   ├── SSHBondTypes.swift           # the same params, events and constants
│   ├── SSHBondSession.swift         # the SSH engine (no Expo imports)
│   ├── SSHBondModule.swift          # Expo Modules API binding
│   └── vendor/libssh2/              # libssh2 1.11.1 sources + Apple config
└── integration/                     # runs the engine against a real sshd
    ├── SSHBondSessionIntegrationTest.kt
    └── run.sh
```

`SSHBondSession` and `SSHPortForwards` deliberately have no Android or Expo
dependency. That keeps the hard part -- handshake, host key gating, PTY, stream
lifetime, and whether a forward really carries bytes -- verifiable on a plain
JVM against a real OpenSSH server rather than only inside an emulator:

```bash
modules/expo-sshbond/integration/run.sh
```

The run starts a throwaway `sshd`, authenticates with a key produced by
SSHBond's own `SSHKeyManager`, and asserts on the emitted events.

### 3.3. Bridge Contract

Methods:

```
connect(options): Promise<void>
  options: { sessionId, hostname, port, username, authType,
             password?, privateKey?, passphrase?,
             timeoutMs, compression, keepAliveIntervalSeconds,
             keepAliveCountMax, proxyJump?, requestTTY, remoteCommand?,
             forwards: [{ id, type: 'local' | 'remote' | 'dynamic',
                          bindAddress?, bindPort, targetHost?, targetPort? }],
             jumps: [{ hostname, port, username, authType,
                       password?, privateKey?, passphrase? }] }

respondToHostKey(sessionId, accept: boolean): Promise<void>
sendData(sessionId, data: string): Promise<void>
resizePTY(sessionId, cols: number, rows: number): Promise<void>
disconnect(sessionId): Promise<void>
```

Events. A single stream serves every session and each payload carries a
`sessionId`, which the JS bridge filters on:

```
onSSHHostKey  { sessionId, hostname, port, algorithm, fingerprint, publicKey }
onSSHStatus   { sessionId, status }
onSSHData     { sessionId, data }
onSSHError    { sessionId, message }
onSSHClose    { sessionId, exitCode }
onSSHTunnel   { sessionId, tunnelId, status, boundPort?, message? }
```

Four invariants any implementation must hold:

1. **The handshake blocks on the host key answer.** `onSSHHostKey` is emitted
   and authentication does not proceed until `respondToHostKey` arrives. `false`
   aborts before a credential is sent. A timeout counts as a refusal.
2. **`connect` must not block the module's dispatch queue.** The Android module
   hands the session to its own thread and settles the promise from there. If it
   blocked while waiting for the host key decision, the `respondToHostKey` call
   carrying that decision could never be delivered and every connection would
   deadlock.
3. **Every host key names the machine it belongs to.** `hostname`/`port` are
   the machine being authenticated, never the address the socket was opened to:
   past the first hop of a ProxyJump chain that is a local forward on
   127.0.0.1, and checking against it would compare every machine in the chain
   to the same known-hosts entry.
4. **A tunnel is `active` only once it is listening.** The engine reports every
   forward it was given, by the `id` the caller minted, and reports the port it
   actually bound -- which is the only way the caller learns the port when the
   rule asked for `0`. Nothing infers success from the engine merely being
   present: a tunnel drawn as working when no channel was opened sends the
   user's traffic into a black hole.

The JS side subscribes to all events *before* calling `connect`, and the engine
claims the channel's streams before connecting it, so nothing emitted during the
handshake is lost.

### 3.4. ProxyJump

The chain is resolved in TypeScript, where the saved hosts and the keystore
live: `SSHProxyJump` turns a `ProxyJump` value into concrete hops -- following
an alias into its saved host, letting `user@host:port` in the directive
override it, expanding a jump host that itself sits behind one, and refusing a
chain that loops. The engine is handed addresses and credentials, and knows
nothing about aliases.

Each hop is a full SSH session. Only the first is dialled directly; every one
after it is entered through a local forward on its predecessor, and the target
through the last hop.

Three decisions worth keeping:

- **A hop is a hop, not a host.** The engine's per-hop record carries an
  address, a user and a credential -- no terminal, forwarding or command
  settings that could be mistaken for the target's.
- **Every machine is vetted on its own.** A chain of *n* hops asks *n + 1*
  times, each against that machine's own known-hosts entry and its own
  `StrictHostKeyChecking`. A stale answer is discarded before each question, so
  a decision that arrived too late for one hop is never spent on the next.
- **Each hop gets its own `JSch` instance.** Identities are registered per
  instance; one machine's key has no business being offered to the next.

An unresolved `ProxyJump` is still refused outright, in TypeScript and again in
the engine. Silently connecting straight to a host the user believes is only
reachable through a bastion is the one outcome worth failing to avoid.

### 3.5. Port Forwarding

`-L` and `-R` are JSch's own forwards; `-D` is a SOCKS proxy implemented in
`SSHPortForwards.kt`, since JSch has no SOCKS server of its own. It answers
SOCKS5 and SOCKS4/4a and opens one `direct-tcpip` channel per accepted
connection.

Three decisions worth keeping:

- **A failed forward does not abort the session.** OpenSSH keeps the shell too
  (`ExitOnForwardFailure` defaults to `no`), but the failure is reported on its
  own tunnel rather than swallowed, so a port that was already taken is visible
  instead of silently absent.
- **The SOCKS channel is opened before the client is answered.** The channel
  must not be handed an input stream, or JSch opens it on a thread of its own
  and a refused connection can no longer be turned into a SOCKS error reply --
  the client would see a granted CONNECT followed by a dead socket.
- **No SOCKS authentication is offered.** The listener binds to loopback unless
  the rule says otherwise, and one reachable from another machine is an open
  proxy that no password on this hop would make safe.

### 3.6. Strict Security Boundaries

1. **No Plaintext Key Storage**: private keys live in the iOS Keychain and
   Android Keystore, optionally gated on biometrics per key.
2. **Zero Insecure Host Key Acceptance**: the policy is enforced in TypeScript
   by `SSHClient` and `SSHKnownHosts` (see `docs/architecture.md` §4.1), so it
   holds regardless of the engine underneath. On Android the JSch
   `HostKeyRepository` is a pure delegate: it stores nothing and answers only
   what JavaScript decides.
3. **No Private Key Transmission**: key material is read from the keystore at
   the moment of authentication and passed straight to the engine.

### 3.7. The iOS Engine

Android talks to JSch; iOS talks to **libssh2 1.11.1, vendored into the module**
and compiled against OpenSSL 3 by `ios/ExpoSSHBond.podspec`.

Vendoring is not a preference. CocoaPods has no maintained libssh2: the pod of
that name is 1.4.3 from 2013, and the wrappers that carry their own copy
(NMSSH, SwiftSH) ship prebuilt binaries from 2019. None can do Ed25519,
curve25519-sha256 or rsa-sha2-*, which is the same reason the Android engine
uses mwiede's JSch fork rather than the original.

The shape differs from Android in one way worth knowing. JSch verifies the host
key through a repository callback *inside* `connect()`; libssh2 completes the
transport handshake first and hands the key back before any authentication call
is made. The invariant is therefore structural on iOS rather than arranged: at
the point the key is offered to JavaScript, no credential exists on the wire
yet.

libssh2 tolerates no concurrent use of one session, so the engine keeps every
call on the session's own thread. Input, resizes and closes arriving from
JavaScript are queued and applied by the pump loop, which parks on the socket
with `poll` between rounds.

### 3.8. Not Yet Implemented

| Feature | State |
| :--- | :--- |
| Port forwarding on iOS | Refused per tunnel, which reports `error` with the reason rather than a tunnel that quietly forwards nothing |
| ProxyJump on iOS | Refused with an explicit error, as Android did before it chained sessions |
| Agent forwarding | Not implemented |
| ProxyCommand | Not implemented; `ProxyJump` covers the common case |

## 4. SSH Abstraction Interface (`ISSHClient`)

The application code communicates exclusively with the following decoupled contract:

```typescript
export interface ISSHConnection {
  readonly id: string;
  readonly host: ResolvedSSHConfig;
  readonly status: ConnectionStatus;
  
  sendInput(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  disconnect(): Promise<void>;
  
  onData(listener: (data: string) => void): () => void;
  onError(listener: (error: SSHError) => void): () => void;
  onClose(listener: (code: number) => void): () => void;
}

export interface ISSHClient {
  connect(config: ResolvedSSHConfig, callbacks: ConnectionCallbacks): Promise<ISSHConnection>;
  verifyHostKey(host: string, port: number, fingerprint: string): Promise<HostKeyVerificationResult>;
}
```

This ensures that whether running on iOS, Android, or under Jest unit tests, the terminal UI, session manager, and config resolver operate against identical semantics.
