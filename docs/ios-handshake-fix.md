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

The corrected native test passed in build 10 (EAS
`a5b4e68e-7ee3-4cf2-b27d-7063e1122476`): external handshake reached host-key
verification; the disposable server accepted the pinned host key and test client
key; the remote command returned `SSHBOND_PROBE_OK` and closed normally.
The external check deliberately rejected the presented key before authentication.
This proves the transport fix on iOS simulator with real SSH endpoints, not a
physical-iPhone run or authentication with the user's production key.

## Distribution

Build 1.0.0 (10) completed and was distributed to the existing internal testers.
EAS submission: `f4039dba-0df2-42fd-a4c2-f71fa4b6e5cb`.
Apple availability email received 12 September 2026 at 08:12 CEST.
IPA verified: ZIP integrity, bundle `com.sshbond.client`, version 1.0.0, build 10,
and existing export setting `ITSAppUsesNonExemptEncryption=false`.
SHA-256: `fd0e76f442bee149c97172a3195594163aaf064f15ae2e3694b99b803d967243`.

Build 10 additionally ran the temporary baseline C probes and external handshake
against the reported host. The committed harness retains the actual Swift
regression test; future routine builds use only the disposable local SSH server.
The iPhone retry with the user's existing production key remains the final
on-device confirmation.
