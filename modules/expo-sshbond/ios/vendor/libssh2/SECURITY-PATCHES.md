# Security patches on vendored libssh2 1.11.1

Applied 2026-09-06. The latest upstream stable release remains 1.11.1.

- CVE-2026-55200: backport upstream [97acf3dfda80c91c3a8c9f2372546301d4a1a7a8](https://github.com/libssh2/libssh2/commit/97acf3dfda80c91c3a8c9f2372546301d4a1a7a8). Reject oversized packet lengths in the second transport decoding path before allocation/copy. The 1.11.1 name `_libssh2_ntohu32` is retained.
- CVE-2026-55199: backport upstream [17626857d20b3c9a1addfa45979dadcee1cd84a4](https://github.com/libssh2/libssh2/commit/17626857d20b3c9a1addfa45979dadcee1cd84a4). Stop EXT_INFO parsing as soon as an extension string is malformed or missing.

These patches must be retained until upgrading to an upstream version containing both fixes. Do not replace this directory with the unpatched 1.11.1 archive.
