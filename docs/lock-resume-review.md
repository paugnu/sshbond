# Screen lock and terminal continuity — 12 September 2026

Production submission is paused pending the user's on-device lock/resume check.

The app lock retained the React navigation tree but applied `display: none` to
its root. Hiding the layout can collapse the WebView frame, trigger xterm fitting
at minimal dimensions, and resize the remote PTY while the user is locking the
phone. Keyboard dismissal can also schedule a fit during this interval.

The lock now hides the retained tree with opacity, blocks pointer input and
accessibility, and retains the existing opaque authentication modal. The terminal
layout remains intact. The terminal document ignores fit requests while hidden
or without usable bounds and refits when visible again. No reconnect, disconnect
or new-session action is introduced.

The document generation was separated from the React wrapper to execute its
actual lifecycle script in a regression test. It checks that zero-size/hidden
resize events do not emit remote PTY resize messages, and normal fitting resumes
when visible. The terminal object remains the same. This is a document lifecycle
unit test, not a physical-iPhone test or a full WebView rendering test.

TypeScript, lint and 165 tests in 15 suites passed. Existing AppLockController
security tests continue to pass.

On-device check: connect, run `echo $$`, change directory, leave output and a
partially typed command visible, lock and unlock. Confirm the same output and
input remain and `echo $$` still reports the same shell PID. Repeat with an
interactive program and multiple lock/unlock cycles. The app must not reconnect
silently. OS process termination or a server/network disconnect is a separate
condition and cannot be described as an indefinitely preserved connection.
