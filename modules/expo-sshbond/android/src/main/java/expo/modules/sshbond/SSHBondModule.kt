package expo.modules.sshbond

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap

class SSHSessionNotFoundException(sessionId: String) :
  CodedException("ERR_SSH_NO_SESSION", "No active SSH session with id \"$sessionId\".", null)

class SSHConnectionFailedException(message: String) :
  CodedException("ERR_SSH_CONNECT", message, null)

class SSHWriteFailedException(message: String) :
  CodedException("ERR_SSH_WRITE", message, null)

/** One port forwarding rule as it arrives from JavaScript. */
class ForwardOption : Record {
  @Field var id: String = ""
  @Field var type: String = "local"
  @Field var bindAddress: String? = null
  @Field var bindPort: Int = 0
  @Field var targetHost: String? = null
  @Field var targetPort: Int? = null

  fun toSpec() = SSHForwardSpec(
    id = id,
    type = SSHForwardType.fromJs(type),
    bindAddress = bindAddress,
    bindPort = bindPort,
    targetHost = targetHost,
    targetPort = targetPort
  )
}

/** One resolved ProxyJump hop as it arrives from JavaScript. */
class JumpOption : Record {
  @Field var hostname: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authType: String = "none"
  @Field var password: String? = null
  @Field var privateKey: String? = null
  @Field var passphrase: String? = null

  fun toJumpHost() = SSHJumpHost(
    hostname = hostname,
    port = port,
    username = username,
    authType = SSHAuthType.fromJs(authType),
    password = password,
    privateKey = privateKey,
    passphrase = passphrase
  )
}

/** Connection options as they arrive from JavaScript. */
class ConnectOptions : Record {
  @Field var sessionId: String = ""
  @Field var hostname: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authType: String = "none"
  @Field var password: String? = null
  @Field var privateKey: String? = null
  @Field var passphrase: String? = null
  @Field var timeoutMs: Int = 30_000
  @Field var compression: Boolean = false
  @Field var keepAliveIntervalSeconds: Int = 0
  @Field var keepAliveCountMax: Int = 3
  @Field var proxyJump: String? = null
  @Field var requestTTY: String = "auto"
  @Field var remoteCommand: String? = null
  @Field var forwards: List<ForwardOption> = emptyList()
  @Field var jumps: List<JumpOption> = emptyList()

  fun toParams() = SSHConnectParams(
    sessionId = sessionId,
    hostname = hostname,
    port = port,
    username = username,
    authType = SSHAuthType.fromJs(authType),
    password = password,
    privateKey = privateKey,
    passphrase = passphrase,
    timeoutMs = timeoutMs,
    compression = compression,
    keepAliveIntervalSeconds = keepAliveIntervalSeconds,
    keepAliveCountMax = keepAliveCountMax,
    proxyJump = proxyJump,
    requestTTY = requestTTY,
    remoteCommand = remoteCommand,
    forwards = forwards.map { it.toSpec() },
    jumps = jumps.map { it.toJumpHost() }
  )
}

/**
 * Expo Modules binding for the SSH engine.
 *
 * Deliberately thin: every function returns promptly and the SSH work happens on
 * each session's own thread. If `connect` blocked this module's dispatch queue
 * while waiting for the host key decision, the `respondToHostKey` call carrying
 * that decision could never be delivered, and every connection would deadlock.
 */
class SSHBondModule : Module() {
  private val sessions = ConcurrentHashMap<String, SSHBondSession>()

  private val eventSink = object : SSHBondEventSink {
    override fun onStatus(sessionId: String, status: String) {
      emit("onSSHStatus", mapOf("sessionId" to sessionId, "status" to status))
    }

    override fun onData(sessionId: String, data: String) {
      emit("onSSHData", mapOf("sessionId" to sessionId, "data" to data))
    }

    override fun onError(sessionId: String, message: String) {
      emit("onSSHError", mapOf("sessionId" to sessionId, "message" to message))
    }

    override fun onClose(sessionId: String, exitCode: Int) {
      sessions.remove(sessionId)
      emit("onSSHClose", mapOf("sessionId" to sessionId, "exitCode" to exitCode))
    }

    override fun onTunnel(
      sessionId: String,
      tunnelId: String,
      status: String,
      boundPort: Int?,
      message: String?
    ) {
      emit(
        "onSSHTunnel",
        mapOf(
          "sessionId" to sessionId,
          "tunnelId" to tunnelId,
          "status" to status,
          "boundPort" to boundPort,
          "message" to message
        )
      )
    }

    override fun onHostKey(sessionId: String, hostKey: SSHPresentedHostKey) {
      emit(
        "onSSHHostKey",
        mapOf(
          "sessionId" to sessionId,
          "hostname" to hostKey.hostname,
          "port" to hostKey.port,
          "algorithm" to hostKey.algorithm,
          "fingerprint" to hostKey.fingerprint,
          "publicKey" to hostKey.publicKey
        )
      )
    }
  }

  /**
   * Events originate on session threads. Once the module is being torn down the
   * JS runtime may already be gone, so a failed send is expected rather than
   * exceptional and must not kill the session thread.
   */
  private fun emit(name: String, body: Map<String, Any?>) {
    try {
      sendEvent(name, body)
    } catch (_: Throwable) {
      // The React context is going away; nothing left to notify.
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SSHBondNative")

    Events("onSSHStatus", "onSSHData", "onSSHError", "onSSHClose", "onSSHHostKey", "onSSHTunnel")

    AsyncFunction("connect") { options: ConnectOptions, promise: Promise ->
      val existing = sessions[options.sessionId]
      if (existing != null && !existing.isClosed) {
        promise.reject(SSHConnectionFailedException("Session ${options.sessionId} is already open."))
        return@AsyncFunction
      }

      val session = SSHBondSession(options.toParams(), eventSink)
      sessions[options.sessionId] = session

      // Returns immediately; the promise is settled from the session thread.
      session.start { error ->
        if (error == null) {
          promise.resolve(null)
        } else {
          sessions.remove(options.sessionId)
          promise.reject(SSHConnectionFailedException(error))
        }
      }
    }

    AsyncFunction("respondToHostKey") { sessionId: String, accept: Boolean ->
      // Must not throw when the session is gone: a user answering the dialog
      // after the server hung up is routine.
      sessions[sessionId]?.provideHostKeyDecision(accept)
    }

    AsyncFunction("sendData") { sessionId: String, data: String ->
      val session = sessions[sessionId] ?: throw SSHSessionNotFoundException(sessionId)
      try {
        session.sendData(data)
      } catch (err: Throwable) {
        throw SSHWriteFailedException(describe(err))
      }
    }

    AsyncFunction("resizePTY") { sessionId: String, cols: Int, rows: Int ->
      sessions[sessionId]?.resizePty(cols, rows)
    }

    AsyncFunction("disconnect") { sessionId: String ->
      sessions.remove(sessionId)?.close(0)
    }

    AsyncFunction("isNativeEngineAvailable") {
      true
    }

    // Reloading the JS bundle in development would otherwise leave orphaned
    // sockets and reader threads behind on every refresh.
    OnDestroy {
      sessions.values.forEach { runCatching { it.close(0) } }
      sessions.clear()
    }
  }
}
