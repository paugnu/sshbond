# iOS handshake failure — 12 September 2026

## Cause and fix

The Swift engine configured libssh2 keepalives before the transport handshake.
libssh2 1.11.1 calls `libssh2_keepalive_send` from its blocking socket wait; the
first keepalive is immediately due. OpenSSH rejects that global request during
key exchange and closes the socket. The library wraps the socket-read failure
(-43) as a misleading ECDH timeout and then generic key-exchange failure (-8).

Move keepalive configuration until after successful host-key verification and
user authentication, before opening the channel. Verification and crypto
algorithms are unchanged. Errors now include the libssh2 result code and clarify
that authentication has not started.

Upstream reports the same timing problem and workaround:
https://github.com/libssh2/libssh2/issues/1810

## Reproduction

- Vendored C transport against the reported OpenSSH server: handshake passes.
- OpenSSL 3.6.2 (matching the beta): handshake passes.
- iOS 26 simulator, packaged OpenSSL framework and vendored C: passes.
- Same simulator running the actual optimized `SSHBondSession.swift`, with a
  keepalive interval of 2400 seconds: reproduces the reported error before any
  credential is sent (EAS diagnostic f1618a3f-f9ff-4ebd-99f1-4303da87284a).
- Enabling the same early keepalive in the otherwise passing C probe reproduces
  the failure on Linux too. This isolates the timing change from Swift and crypto.

The diagnostic EAS jobs intentionally stopped after the probe rather than
building a beta; their final job status is not the individual probe result.

## Config editor

Do not invent `~/.ssh/<internal identity ID>` for a keystore key. Preserve public-key
authentication through an OpenSSH config round trip with `PreferredAuthentications
publickey`; display the selected stored key separately. Preserve explicitly
imported IdentityFile metadata and retain the currently selected identity when
saving raw edits. Two regression tests added (164 Jest tests pass).

## Native regression check

`scripts/probe-ios-handshake.sh`, enabled by `SSHBOND_HANDSHAKE_PROBE=1` on EAS,
compiles the real optimized Swift session and vendored library for an iOS
simulator. It creates a disposable loopback OpenSSH server and ephemeral keys,
pins its generated host fingerprint, authenticates, and checks command output.
`SSHBOND_PROBE_HOST` optionally adds an external handshake-only check which
rejects the host key and sends no credentials. Routine builds do not depend on
any production server. No Android SDK is installed locally.

Availability and final native test outcome are recorded after the build finishes.
