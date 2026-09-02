import Foundation
import Libssh2

/**
 * One SSH session: transport, authentication, PTY and its pump loop.
 *
 * Everything happens on the thread `start` spawns. The Expo module never blocks
 * its own dispatch queue on this class, which is what allows
 * `provideHostKeyDecision` to be called from JavaScript while the handshake is
 * still waiting for an answer.
 *
 * libssh2 is not safe to use from two threads at once, so no call into it
 * happens anywhere but that thread: input, resizes and closes are queued and
 * applied by the loop.
 */
final class SSHBondSession {
  private enum Constants {
    static let defaultCols: Int32 = 80
    static let defaultRows: Int32 = 24
    static let ptyType = "xterm-256color"
    static let readBufferBytes = 8192
    /// Refusing after this long stops a forgotten prompt pinning a thread forever.
    static let hostKeyDecisionTimeout: TimeInterval = 300
    /// How long the loop parks on the socket before servicing the queues.
    static let pollIntervalMs: Int32 = 100
    /**
     * libssh2's own defaults, restated.
     *
     * `LIBSSH2_CHANNEL_WINDOW_DEFAULT` is `(2*1024*1024)` -- a macro holding an
     * expression, which Swift does not import at all -- and
     * `LIBSSH2_CHANNEL_PACKET_DEFAULT` imports as Int32 where the C prototype
     * asks for an unsigned int.
     */
    static let channelWindowSize: UInt32 = 2 * 1024 * 1024
    static let channelPacketSize: UInt32 = 32768
  }

  /// libssh2 has process-wide state that has to be set up exactly once.
  private static let libraryReady: Bool = {
    return libssh2_init(0) == 0
  }()

  private let params: SSHConnectParams
  private let events: SSHBondEventSink

  private var socketFd: Int32 = -1
  private var session: OpaquePointer?
  private var channel: OpaquePointer?

  private let lock = NSLock()
  private var pendingWrites: [Data] = []
  private var pendingResize: (cols: Int32, rows: Int32)?
  private var closeRequested = false

  private let hostKeyDecided = DispatchSemaphore(value: 0)
  private var hostKeyAccepted = false
  private var hostKeyAnswered = false

  private var closed = false
  private var started = false
  private var decoder = IncrementalUTF8Decoder()

  init(params: SSHConnectParams, events: SSHBondEventSink) {
    self.params = params
    self.events = events
  }

  var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }

  /**
   * Runs the whole handshake on a dedicated thread. `onResult` is invoked once,
   * with nil on success or a message on failure, so the caller can settle the
   * JavaScript promise without blocking.
   */
  func start(onResult: @escaping (String?) -> Void) {
    lock.lock()
    if started {
      lock.unlock()
      onResult("Session \(params.sessionId) has already been started.")
      return
    }
    started = true
    lock.unlock()

    let thread = Thread { [weak self] in
      guard let self else { return }
      do {
        try self.connectBlocking()
        onResult(nil)
        self.pumpOutput()
      } catch {
        let message = describe(error)
        if !self.isClosed {
          self.events.onStatus(sessionId: self.params.sessionId, status: SSHStatus.error)
          self.events.onError(sessionId: self.params.sessionId, message: message)
        }
        onResult(message)
        self.close(exitCode: 1)
      }
    }

    thread.name = "sshbond-\(params.sessionId)"
    thread.stackSize = 512 * 1024
    thread.start()
  }

  // MARK: - Connect

  private func connectBlocking() throws {
    guard SSHBondSession.libraryReady else {
      throw SSHBondError.message("libssh2 could not be initialised.")
    }

    if let proxyJump = params.proxyJump, !proxyJump.trimmingCharacters(in: .whitespaces).isEmpty {
      // Silently ignoring ProxyJump would open a direct connection to a host the
      // user believes is only reachable through a bastion. The iOS engine does
      // not chain sessions yet, so it refuses rather than connecting directly.
      throw SSHBondError.message(
        "ProxyJump is not supported by the iOS engine yet (requested: \(proxyJump))."
      )
    }

    if !params.forwards.isEmpty {
      // Reported per tunnel rather than thrown: as on Android, a forward that
      // cannot be established must not cost the user their shell.
      for spec in params.forwards {
        events.onTunnel(
          sessionId: params.sessionId,
          tunnelId: spec.id,
          status: SSHTunnelStatus.error,
          boundPort: nil,
          message: "Port forwarding is not supported by the iOS engine yet."
        )
      }
    }

    events.onStatus(sessionId: params.sessionId, status: SSHStatus.connecting)

    socketFd = try openSocket(host: params.hostname, port: params.port, timeoutMs: params.timeoutMs)

    guard let session = libssh2_session_init_ex(nil, nil, nil, nil) else {
      throw SSHBondError.message("Could not create an SSH session.")
    }
    self.session = session

    libssh2_session_set_blocking(session, 1)

    if params.compression {
      libssh2_session_flag(session, LIBSSH2_FLAG_COMPRESS, 1)
    }

    if params.keepAliveIntervalSeconds > 0 {
      libssh2_keepalive_config(session, 1, UInt32(params.keepAliveIntervalSeconds))
    }

    guard libssh2_session_handshake(session, socketFd) == 0 else {
      throw SSHBondError.message("Handshake failed: \(lastError(session))")
    }

    try gateOnHostKey(session)

    events.onStatus(sessionId: params.sessionId, status: SSHStatus.authenticating)
    try authenticate(session)

    let channel = try openChannel(session)
    self.channel = channel

    events.onStatus(sessionId: params.sessionId, status: SSHStatus.connected)

    // From here the loop owns the session, and every call has to tolerate
    // EAGAIN rather than parking the thread inside libssh2.
    libssh2_session_set_blocking(session, 0)
  }

  /**
   * Hands the server's key to JavaScript and blocks until it answers.
   *
   * libssh2 completes the transport handshake before any credential is sent, so
   * this sits exactly in the gap the security model requires: the key is known,
   * nothing secret has left the device yet.
   */
  private func gateOnHostKey(_ session: OpaquePointer) throws {
    events.onStatus(sessionId: params.sessionId, status: SSHStatus.verifyingHost)

    var keyLength = 0
    var keyType: Int32 = 0
    guard let keyBytes = libssh2_session_hostkey(session, &keyLength, &keyType) else {
      throw SSHBondError.message("The server presented no host key.")
    }

    let blob = Data(bytes: keyBytes, count: keyLength)
    let algorithm = hostKeyAlgorithm(keyType)

    guard let hashBytes = libssh2_hostkey_hash(session, LIBSSH2_HOSTKEY_HASH_SHA256) else {
      throw SSHBondError.message("The server's host key could not be fingerprinted.")
    }

    let digest = Data(bytes: hashBytes, count: 32)

    events.onHostKey(
      sessionId: params.sessionId,
      hostKey: SSHPresentedHostKey(
        hostname: params.hostname,
        port: params.port,
        algorithm: algorithm,
        fingerprint: "SHA256:" + base64Unpadded(digest),
        publicKey: "\(algorithm) \(blob.base64EncodedString())"
      )
    )

    // A timeout is a refusal: never continue with an unanswered key.
    let answered = hostKeyDecided.wait(timeout: .now() + Constants.hostKeyDecisionTimeout)
    lock.lock()
    let accepted = answered == .success && hostKeyAccepted
    lock.unlock()

    if !accepted {
      throw SSHBondError.message("Host key verification failed: the key was not approved.")
    }
  }

  private func authenticate(_ session: OpaquePointer) throws {
    switch params.authType {
    case .password:
      let password = params.password ?? ""
      let result = libssh2_userauth_password_ex(
        session,
        params.username, UInt32(params.username.utf8.count),
        password, UInt32(password.utf8.count),
        nil
      )
      guard result == 0 else {
        throw SSHBondError.message("Authentication failed: \(lastError(session))")
      }

    case .key:
      guard let privateKey = params.privateKey else {
        throw SSHBondError.message("Key authentication was requested without a private key.")
      }
      let username = params.username
      let result: Int32

      if let passphrase = params.passphrase {
        result = passphrase.withCString { passphrasePointer in
          libssh2_userauth_publickey_frommemory(
            session,
            username, username.utf8.count,
            nil, 0,
            privateKey, privateKey.utf8.count,
            passphrasePointer
          )
        }
      } else {
        // NULL and an empty string mean different things to libssh2: the second
        // would have it try to decrypt an unencrypted key.
        result = libssh2_userauth_publickey_frommemory(
          session,
          username, username.utf8.count,
          nil, 0,
          privateKey, privateKey.utf8.count,
          nil
        )
      }

      guard result == 0 else {
        throw SSHBondError.message("Authentication failed: \(lastError(session))")
      }

    case .none:
      let result = libssh2_userauth_password_ex(
        session,
        params.username, UInt32(params.username.utf8.count),
        "", 0,
        nil
      )
      guard result == 0 else {
        throw SSHBondError.message("Authentication failed: \(lastError(session))")
      }
    }
  }

  private func openChannel(_ session: OpaquePointer) throws -> OpaquePointer {
    guard let channel = libssh2_channel_open_ex(
      session, "session", 7,
      Constants.channelWindowSize, Constants.channelPacketSize,
      nil, 0
    ) else {
      throw SSHBondError.message("Could not open a session channel: \(lastError(session))")
    }

    if params.requestTTY != "no" {
      let term = Constants.ptyType
      let result = libssh2_channel_request_pty_ex(
        channel, term, UInt32(term.utf8.count),
        nil, 0,
        Constants.defaultCols, Constants.defaultRows, 0, 0
      )
      guard result == 0 else {
        throw SSHBondError.message("Could not allocate a PTY: \(lastError(session))")
      }
    }

    if let command = params.remoteCommand, !command.isEmpty {
      let result = libssh2_channel_process_startup(
        channel, "exec", 4, command, UInt32(command.utf8.count)
      )
      guard result == 0 else {
        throw SSHBondError.message("Could not run the remote command: \(lastError(session))")
      }
    } else {
      let result = libssh2_channel_process_startup(channel, "shell", 5, nil, 0)
      guard result == 0 else {
        throw SSHBondError.message("Could not start a shell: \(lastError(session))")
      }
    }

    return channel
  }

  // MARK: - Pump

  /**
   * Services the session until the channel ends.
   *
   * Reads, writes and resizes all happen here because libssh2 tolerates no
   * concurrent use of one session. The socket poll gives the loop something to
   * park on so an idle session costs nothing.
   */
  private func pumpOutput() {
    guard let session, let channel else { return }

    var stdoutBuffer = [Int8](repeating: 0, count: Constants.readBufferBytes)
    var stderrBuffer = [Int8](repeating: 0, count: Constants.readBufferBytes)

    while !isClosed {
      lock.lock()
      let shouldClose = closeRequested
      let resize = pendingResize
      pendingResize = nil
      let writes = pendingWrites
      pendingWrites = []
      lock.unlock()

      if shouldClose { break }

      if let resize {
        libssh2_channel_request_pty_size_ex(channel, resize.cols, resize.rows, 0, 0)
      }

      for data in writes {
        writeAll(channel: channel, data: data)
      }

      let readAny = drain(channel: channel, streamId: 0, buffer: &stdoutBuffer)
        || drain(channel: channel, streamId: Int32(SSH_EXTENDED_DATA_STDERR), buffer: &stderrBuffer)

      if libssh2_channel_eof(channel) == 1 { break }

      if !readAny {
        // Nothing was waiting: sleep on the socket rather than spinning.
        var fds = pollfd(fd: socketFd, events: Int16(POLLIN), revents: 0)
        poll(&fds, nfds_t(1), Constants.pollIntervalMs)

        if params.keepAliveIntervalSeconds > 0 {
          var secondsToNext: Int32 = 0
          libssh2_keepalive_send(session, &secondsToNext)
        }
      }
    }

    let flushed = decoder.flush()
    if !flushed.isEmpty {
      events.onData(sessionId: params.sessionId, data: flushed)
    }

    let exitStatus = libssh2_channel_get_exit_status(channel)
    close(exitCode: Int(exitStatus >= 0 ? exitStatus : 0))
  }

  /// Reads one stream until it would block. Returns whether anything arrived.
  private func drain(channel: OpaquePointer, streamId: Int32, buffer: inout [Int8]) -> Bool {
    var received = false

    let capacity = buffer.count

    while true {
      let count = libssh2_channel_read_ex(channel, streamId, &buffer, capacity)

      if count == Int(LIBSSH2_ERROR_EAGAIN) || count == 0 { return received }
      if count < 0 {
        if !isClosed, let session {
          events.onError(sessionId: params.sessionId, message: lastError(session))
        }
        return received
      }

      received = true
      let text = buffer.withUnsafeBytes { raw in
        decoder.decode(Data(raw.prefix(count)))
      }
      if !text.isEmpty {
        events.onData(sessionId: params.sessionId, data: text)
      }
    }
  }

  private func writeAll(channel: OpaquePointer, data: Data) {
    var remaining = data

    while !remaining.isEmpty && !isClosed {
      let written = remaining.withUnsafeBytes { raw -> Int in
        guard let base = raw.baseAddress else { return 0 }
        return libssh2_channel_write_ex(
          channel, 0, base.assumingMemoryBound(to: CChar.self), remaining.count
        )
      }

      if written == Int(LIBSSH2_ERROR_EAGAIN) {
        var fds = pollfd(fd: socketFd, events: Int16(POLLOUT), revents: 0)
        poll(&fds, nfds_t(1), Constants.pollIntervalMs)
        continue
      }

      if written < 0 {
        if !isClosed, let session {
          events.onError(sessionId: params.sessionId, message: lastError(session))
        }
        return
      }

      remaining = remaining.dropFirst(written)
    }
  }

  // MARK: - Commands from JavaScript

  func sendData(_ text: String) throws {
    guard !isClosed else {
      throw SSHBondError.message("Session \(params.sessionId) is not writable.")
    }
    lock.lock()
    pendingWrites.append(Data(text.utf8))
    lock.unlock()
  }

  func resizePty(cols: Int, rows: Int) {
    // A resize arriving after the channel closed is routine, not an error.
    guard !isClosed else { return }
    lock.lock()
    pendingResize = (cols: Int32(cols), rows: Int32(rows))
    lock.unlock()
  }

  /// Answers a pending host key prompt. Extra answers are ignored.
  func provideHostKeyDecision(_ accepted: Bool) {
    lock.lock()
    if hostKeyAnswered {
      lock.unlock()
      return
    }
    hostKeyAnswered = true
    hostKeyAccepted = accepted
    lock.unlock()

    hostKeyDecided.signal()
  }

  func close(exitCode: Int = 0) {
    lock.lock()
    if closed {
      lock.unlock()
      return
    }
    closed = true
    closeRequested = true
    let channelToFree = channel
    let sessionToFree = session
    let fd = socketFd
    channel = nil
    session = nil
    socketFd = -1
    lock.unlock()

    // Unblock a handshake still waiting on a decision that will never come.
    lock.lock()
    let needsUnblocking = !hostKeyAnswered
    hostKeyAnswered = true
    lock.unlock()

    if needsUnblocking {
      hostKeyDecided.signal()
    }

    if let channelToFree {
      libssh2_channel_close(channelToFree)
      libssh2_channel_free(channelToFree)
    }

    if let sessionToFree {
      libssh2_session_disconnect_ex(sessionToFree, SSH_DISCONNECT_BY_APPLICATION, "SSHBond closing", "")
      libssh2_session_free(sessionToFree)
    }

    if fd >= 0 {
      Darwin.close(fd)
    }

    events.onStatus(sessionId: params.sessionId, status: SSHStatus.disconnected)
    events.onClose(sessionId: params.sessionId, exitCode: exitCode)
  }

  // MARK: - Helpers

  private func lastError(_ session: OpaquePointer) -> String {
    var buffer: UnsafeMutablePointer<CChar>?
    var length: Int32 = 0
    let code = libssh2_session_last_error(session, &buffer, &length, 0)

    guard let buffer, length > 0 else { return "libssh2 error \(code)" }
    return String(cString: buffer)
  }

  private func hostKeyAlgorithm(_ type: Int32) -> String {
    switch type {
    case Int32(LIBSSH2_HOSTKEY_TYPE_RSA): return "ssh-rsa"
    case Int32(LIBSSH2_HOSTKEY_TYPE_DSS): return "ssh-dss"
    case Int32(LIBSSH2_HOSTKEY_TYPE_ECDSA_256): return "ecdsa-sha2-nistp256"
    case Int32(LIBSSH2_HOSTKEY_TYPE_ECDSA_384): return "ecdsa-sha2-nistp384"
    case Int32(LIBSSH2_HOSTKEY_TYPE_ECDSA_521): return "ecdsa-sha2-nistp521"
    case Int32(LIBSSH2_HOSTKEY_TYPE_ED25519): return "ssh-ed25519"
    default: return "unknown"
    }
  }

  /**
   * Opens a TCP connection, honouring the configured timeout.
   *
   * The socket is put in non-blocking mode for the connect so the timeout can
   * be enforced, then returned to blocking for the handshake.
   */
  private func openSocket(host: String, port: Int, timeoutMs: Int) throws -> Int32 {
    var hints = addrinfo(
      ai_flags: 0,
      ai_family: AF_UNSPEC,
      ai_socktype: SOCK_STREAM,
      ai_protocol: IPPROTO_TCP,
      ai_addrlen: 0,
      ai_canonname: nil,
      ai_addr: nil,
      ai_next: nil
    )

    var results: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, String(port), &hints, &results) == 0, let list = results else {
      throw SSHBondError.message("Could not resolve \(host).")
    }
    defer { freeaddrinfo(list) }

    var lastFailure = "Could not connect to \(host):\(port)."
    var candidate = Optional(list)

    while let info = candidate {
      let fd = socket(info.pointee.ai_family, info.pointee.ai_socktype, info.pointee.ai_protocol)
      if fd < 0 {
        candidate = info.pointee.ai_next
        continue
      }

      var noSigPipe: Int32 = 1
      setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

      let flags = fcntl(fd, F_GETFL, 0)
      _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

      var connected = connect(fd, info.pointee.ai_addr, info.pointee.ai_addrlen) == 0

      if !connected && errno == EINPROGRESS {
        var fds = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        if poll(&fds, nfds_t(1), Int32(timeoutMs)) > 0 {
          var socketError: Int32 = 0
          var size = socklen_t(MemoryLayout<Int32>.size)
          getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketError, &size)
          connected = socketError == 0
          if !connected {
            lastFailure = "Could not connect to \(host):\(port): \(String(cString: strerror(socketError)))."
          }
        } else {
          lastFailure = "Timed out connecting to \(host):\(port)."
        }
      } else if !connected {
        lastFailure = "Could not connect to \(host):\(port): \(String(cString: strerror(errno)))."
      }

      if connected {
        _ = fcntl(fd, F_SETFL, flags)
        return fd
      }

      Darwin.close(fd)
      candidate = info.pointee.ai_next
    }

    throw SSHBondError.message(lastFailure)
  }
}

/// `ssh-keygen -l` style fingerprint body: unpadded base64.
private func base64Unpadded(_ data: Data) -> String {
  return data.base64EncodedString().replacingOccurrences(of: "=", with: "")
}

func describe(_ error: Error) -> String {
  if let bond = error as? SSHBondError, case .message(let text) = bond { return text }
  return error.localizedDescription
}

/**
 * Decodes PTY output to text across chunk boundaries.
 *
 * A read can end in the middle of a multi-byte character; decoding each chunk
 * on its own would turn that into replacement characters and corrupt any
 * non-ASCII output. Undecoded trailing bytes are carried into the next read.
 */
struct IncrementalUTF8Decoder {
  private var pending = Data()

  mutating func decode(_ chunk: Data) -> String {
    pending.append(chunk)

    // Walk back over at most three bytes looking for a lead byte that starts a
    // sequence the buffer does not yet hold in full.
    var usable = pending.count
    var index = pending.count - 1
    var trailing = 0

    while index >= 0 && trailing < 4 {
      let byte = pending[pending.startIndex + index]

      if byte & 0b1100_0000 != 0b1000_0000 {
        let needed = expectedLength(byte)
        if needed > trailing + 1 {
          usable = index
        }
        break
      }

      trailing += 1
      index -= 1
    }

    let ready = pending.prefix(usable)
    pending = pending.dropFirst(usable)

    return String(decoding: ready, as: UTF8.self)
  }

  mutating func flush() -> String {
    let remainder = pending
    pending = Data()
    return String(decoding: remainder, as: UTF8.self)
  }

  private func expectedLength(_ leadByte: UInt8) -> Int {
    if leadByte & 0b1000_0000 == 0 { return 1 }
    if leadByte & 0b1110_0000 == 0b1100_0000 { return 2 }
    if leadByte & 0b1111_0000 == 0b1110_0000 { return 3 }
    if leadByte & 0b1111_1000 == 0b1111_0000 { return 4 }
    return 1
  }
}
