import ExpoModulesCore

/// One port forwarding rule as it arrives from JavaScript.
internal struct ForwardOption: Record {
  @Field var id: String = ""
  @Field var type: String = "local"
  @Field var bindAddress: String?
  @Field var bindPort: Int = 0
  @Field var targetHost: String?
  @Field var targetPort: Int?

  func toSpec() throws -> SSHForwardSpec {
    return SSHForwardSpec(
      id: id,
      type: try SSHForwardType.fromJs(type),
      bindAddress: bindAddress,
      bindPort: bindPort,
      targetHost: targetHost,
      targetPort: targetPort
    )
  }
}

/// One resolved ProxyJump hop as it arrives from JavaScript.
internal struct JumpOption: Record {
  @Field var hostname: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authType: String = "none"
  @Field var password: String?
  @Field var privateKey: String?
  @Field var passphrase: String?

  func toJumpHost() -> SSHJumpHost {
    return SSHJumpHost(
      hostname: hostname,
      port: port,
      username: username,
      authType: SSHAuthType.fromJs(authType),
      password: password,
      privateKey: privateKey,
      passphrase: passphrase
    )
  }
}

/// Connection options as they arrive from JavaScript.
internal struct ConnectOptions: Record {
  @Field var sessionId: String = ""
  @Field var hostname: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authType: String = "none"
  @Field var password: String?
  @Field var privateKey: String?
  @Field var passphrase: String?
  @Field var timeoutMs: Int = 30000
  @Field var compression: Bool = false
  @Field var keepAliveIntervalSeconds: Int = 0
  @Field var keepAliveCountMax: Int = 3
  @Field var proxyJump: String?
  @Field var requestTTY: String = "auto"
  @Field var remoteCommand: String?
  @Field var forwards: [ForwardOption] = []
  @Field var jumps: [JumpOption] = []

  func toParams() throws -> SSHConnectParams {
    return SSHConnectParams(
      sessionId: sessionId,
      hostname: hostname,
      port: port,
      username: username,
      authType: SSHAuthType.fromJs(authType),
      password: password,
      privateKey: privateKey,
      passphrase: passphrase,
      timeoutMs: timeoutMs,
      compression: compression,
      keepAliveIntervalSeconds: keepAliveIntervalSeconds,
      keepAliveCountMax: keepAliveCountMax,
      proxyJump: proxyJump,
      requestTTY: requestTTY,
      remoteCommand: remoteCommand,
      forwards: try forwards.map { try $0.toSpec() },
      jumps: jumps.map { $0.toJumpHost() }
    )
  }
}

internal final class SSHSessionNotFoundException: GenericException<String> {
  override var reason: String {
    "No active SSH session with id \"\(param)\"."
  }
}

internal final class SSHConnectionFailedException: GenericException<String> {
  override var reason: String {
    param
  }
}

/**
 * Expo Modules binding for the SSH engine.
 *
 * Deliberately thin, and for the same reason as its Android counterpart: if
 * `connect` blocked this module's queue while waiting for the host key
 * decision, the `respondToHostKey` call carrying that decision could never be
 * delivered, and every connection would deadlock.
 */
public final class SSHBondModule: Module {
  private var sessions: [String: SSHBondSession] = [:]
  private let sessionsLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("SSHBondNative")

    Events("onSSHStatus", "onSSHData", "onSSHError", "onSSHClose", "onSSHHostKey", "onSSHTunnel")

    AsyncFunction("connect") { (options: ConnectOptions, promise: Promise) in
      let params = try options.toParams()

      if let existing = self.session(for: params.sessionId), !existing.isClosed {
        promise.reject(SSHConnectionFailedException("Session \(params.sessionId) is already open."))
        return
      }

      let session = SSHBondSession(params: params, events: self.eventSink)
      self.store(session, for: params.sessionId)

      // Returns immediately; the promise is settled from the session thread.
      session.start { error in
        if let error {
          self.remove(params.sessionId)
          promise.reject(SSHConnectionFailedException(error))
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("respondToHostKey") { (sessionId: String, accept: Bool) in
      // Must not throw when the session is gone: a user answering the dialog
      // after the server hung up is routine.
      self.session(for: sessionId)?.provideHostKeyDecision(accept)
    }

    AsyncFunction("sendData") { (sessionId: String, data: String) in
      guard let session = self.session(for: sessionId) else {
        throw SSHSessionNotFoundException(sessionId)
      }
      try session.sendData(data)
    }

    AsyncFunction("resizePTY") { (sessionId: String, cols: Int, rows: Int) in
      self.session(for: sessionId)?.resizePty(cols: cols, rows: rows)
    }

    AsyncFunction("disconnect") { (sessionId: String) in
      let session = self.remove(sessionId)
      session?.close(exitCode: 0)
    }

    AsyncFunction("isNativeEngineAvailable") { () -> Bool in
      true
    }

    // Reloading the JS bundle in development would otherwise leave orphaned
    // sockets and threads behind on every refresh.
    OnDestroy {
      let open = self.drainSessions()
      for session in open {
        session.close(exitCode: 0)
      }
    }
  }

  // MARK: - Session registry

  private func session(for id: String) -> SSHBondSession? {
    sessionsLock.lock()
    defer { sessionsLock.unlock() }
    return sessions[id]
  }

  private func store(_ session: SSHBondSession, for id: String) {
    sessionsLock.lock()
    sessions[id] = session
    sessionsLock.unlock()
  }

  @discardableResult
  private func remove(_ id: String) -> SSHBondSession? {
    sessionsLock.lock()
    defer { sessionsLock.unlock() }
    return sessions.removeValue(forKey: id)
  }

  private func drainSessions() -> [SSHBondSession] {
    sessionsLock.lock()
    defer { sessionsLock.unlock() }
    let open = Array(sessions.values)
    sessions.removeAll()
    return open
  }

  // MARK: - Events

  private lazy var eventSink: SSHBondEventSink = ModuleEventSink(module: self)

  /**
   * Events originate on session threads. Once the module is being torn down the
   * JS runtime may already be gone, so a failed send is expected rather than
   * exceptional and must not kill the session thread.
   */
  fileprivate func emit(_ name: String, _ body: [String: Any?]) {
    sendEvent(name, body)
  }

  fileprivate func forget(_ sessionId: String) {
    remove(sessionId)
  }
}

/// Bridges the engine's plain-Swift sink onto the module's event stream.
private final class ModuleEventSink: SSHBondEventSink {
  private unowned let module: SSHBondModule

  init(module: SSHBondModule) {
    self.module = module
  }

  func onStatus(sessionId: String, status: String) {
    module.emit("onSSHStatus", ["sessionId": sessionId, "status": status])
  }

  func onData(sessionId: String, data: String) {
    module.emit("onSSHData", ["sessionId": sessionId, "data": data])
  }

  func onError(sessionId: String, message: String) {
    module.emit("onSSHError", ["sessionId": sessionId, "message": message])
  }

  func onClose(sessionId: String, exitCode: Int) {
    module.forget(sessionId)
    module.emit("onSSHClose", ["sessionId": sessionId, "exitCode": exitCode])
  }

  func onHostKey(sessionId: String, hostKey: SSHPresentedHostKey) {
    module.emit("onSSHHostKey", [
      "sessionId": sessionId,
      "hostname": hostKey.hostname,
      "port": hostKey.port,
      "algorithm": hostKey.algorithm,
      "fingerprint": hostKey.fingerprint,
      "publicKey": hostKey.publicKey
    ])
  }

  func onTunnel(sessionId: String, tunnelId: String, status: String, boundPort: Int?, message: String?) {
    module.emit("onSSHTunnel", [
      "sessionId": sessionId,
      "tunnelId": tunnelId,
      "status": status,
      "boundPort": boundPort,
      "message": message
    ])
  }
}
