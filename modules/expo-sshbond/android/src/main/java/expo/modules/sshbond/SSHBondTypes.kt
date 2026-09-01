package expo.modules.sshbond

/**
 * Everything in this file and in SSHBondSession.kt is plain JVM Kotlin with no
 * Android or Expo dependency, so the SSH engine can be compiled and exercised
 * against a real sshd outside of an emulator. Only SSHBondModule.kt binds it to
 * the Expo Modules API.
 */

/** Mirrors the ConnectionStatus union on the TypeScript side. */
object SSHStatus {
  const val CONNECTING = "connecting"
  const val VERIFYING_HOST = "verifying_host"
  const val AUTHENTICATING = "authenticating"
  const val CONNECTED = "connected"
  const val ERROR = "error"
  const val DISCONNECTED = "disconnected"
}

/** Mirrors the TunnelStatus union on the TypeScript side. */
object SSHTunnelStatus {
  const val ACTIVE = "active"
  const val ERROR = "error"
  const val STOPPED = "stopped"
}

enum class SSHAuthType {
  PASSWORD,
  KEY,
  NONE;

  companion object {
    fun fromJs(value: String?): SSHAuthType = when (value) {
      "password" -> PASSWORD
      "key" -> KEY
      else -> NONE
    }
  }
}

enum class SSHForwardType {
  LOCAL,
  REMOTE,
  DYNAMIC;

  companion object {
    fun fromJs(value: String?): SSHForwardType = when (value) {
      "local" -> LOCAL
      "remote" -> REMOTE
      "dynamic" -> DYNAMIC
      else -> throw IllegalArgumentException("Unknown port forward type \"$value\".")
    }
  }
}

/**
 * One `-L` / `-R` / `-D` rule.
 *
 * [id] is minted on the JavaScript side and echoed back in every tunnel event,
 * so a status always lands on the row the user is looking at rather than being
 * matched back by port number, which is ambiguous while a port is still 0.
 */
data class SSHForwardSpec(
  val id: String,
  val type: SSHForwardType,
  val bindAddress: String? = null,
  /** 0 asks for an allocated port: by the OS for `-L`/`-D`, by the server for `-R`. */
  val bindPort: Int = 0,
  /** Where the far end should connect to. Unused by [SSHForwardType.DYNAMIC]. */
  val targetHost: String? = null,
  val targetPort: Int? = null
)

/**
 * One machine to authenticate to on the way to the target.
 *
 * The chain is resolved on the JavaScript side, where the saved hosts and the
 * keystore live; the engine is given concrete addresses and credentials.
 */
data class SSHJumpHost(
  val hostname: String,
  val port: Int,
  val username: String,
  val authType: SSHAuthType,
  val password: String? = null,
  val privateKey: String? = null,
  val passphrase: String? = null
)

data class SSHConnectParams(
  val sessionId: String,
  val hostname: String,
  val port: Int,
  val username: String,
  val authType: SSHAuthType,
  /** Password for password auth. */
  val password: String? = null,
  /** PEM/OpenSSH private key for key auth. */
  val privateKey: String? = null,
  /** Passphrase protecting [privateKey], when it is encrypted. */
  val passphrase: String? = null,
  val timeoutMs: Int = 30_000,
  val compression: Boolean = false,
  val keepAliveIntervalSeconds: Int = 0,
  val keepAliveCountMax: Int = 3,
  val proxyJump: String? = null,
  val requestTTY: String = "auto",
  val remoteCommand: String? = null,
  val forwards: List<SSHForwardSpec> = emptyList(),
  val jumps: List<SSHJumpHost> = emptyList()
)

/** Host key offered by a server, formatted the way SSHBond stores it. */
data class SSHPresentedHostKey(
  /**
   * The machine the key belongs to -- a jump host, or the target. Never the
   * address the socket was opened to: past the first hop that is a local
   * forward on 127.0.0.1, and checking a key against it would compare every
   * machine in the chain to the same known-hosts entry.
   */
  val hostname: String,
  val port: Int,
  val algorithm: String,
  val fingerprint: String,
  val publicKey: String
)

/**
 * Events pushed up to JavaScript. Implemented by the Expo module in production
 * and by a recorder in tests.
 */
interface SSHBondEventSink {
  fun onStatus(sessionId: String, status: String)
  fun onData(sessionId: String, data: String)
  fun onError(sessionId: String, message: String)
  fun onClose(sessionId: String, exitCode: Int)
  fun onHostKey(sessionId: String, hostKey: SSHPresentedHostKey)

  /**
   * Reports what a declared forward actually did. [boundPort] is the port that
   * ended up being listened on, which is only known to the engine when the rule
   * asked for port 0.
   */
  fun onTunnel(
    sessionId: String,
    tunnelId: String,
    status: String,
    boundPort: Int?,
    message: String?
  )
}
