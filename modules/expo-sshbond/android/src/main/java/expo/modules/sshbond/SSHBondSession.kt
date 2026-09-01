package expo.modules.sshbond

import com.jcraft.jsch.Channel
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One SSH session: transport, authentication, PTY and its reader thread.
 *
 * Everything happens on the thread [start] spawns. The Expo module never blocks
 * its own dispatch queue on this class, which is what allows
 * [provideHostKeyDecision] to be called from JavaScript while the handshake is
 * still waiting for an answer.
 */
class SSHBondSession(
  private val params: SSHConnectParams,
  private val events: SSHBondEventSink
) {
  /** Terminal geometry before JavaScript reports the real size. */
  private companion object {
    const val DEFAULT_COLS = 80
    const val DEFAULT_ROWS = 24
    const val PTY_TYPE = "xterm-256color"
    const val READ_BUFFER_BYTES = 8192
    /** Refusing after this long stops a forgotten prompt pinning a thread forever. */
    const val HOST_KEY_DECISION_TIMEOUT_SECONDS = 300L
    const val LOOPBACK = "127.0.0.1"
  }

  /** Where a socket is opened to, as opposed to which machine answers on it. */
  private class Address(val host: String, val port: Int)

  private val hostKeyDecision = ArrayBlockingQueue<Boolean>(1)
  private val closed = AtomicBoolean(false)
  private val started = AtomicBoolean(false)

  private var session: Session? = null
  /** The ProxyJump chain, in the order it was opened; torn down in reverse. */
  private val jumpSessions = mutableListOf<Session>()
  private var channel: Channel? = null
  /**
   * PTY resize lives on ChannelShell/ChannelExec, not on the public Channel
   * type, so the concrete channel is captured here instead of downcasting.
   */
  private var resizePtyHandler: ((Int, Int) -> Unit)? = null
  private var stdin: OutputStream? = null
  private var stdout: InputStream? = null
  private var stderr: InputStream? = null
  private var readerThread: Thread? = null
  private var forwards: SSHPortForwards? = null

  /**
   * Runs the whole handshake on a dedicated thread. [onResult] is invoked once,
   * with null on success or a message on failure, so the caller can settle the
   * JavaScript promise without blocking.
   */
  fun start(onResult: (String?) -> Unit) {
    if (!started.compareAndSet(false, true)) {
      onResult("Session ${params.sessionId} has already been started.")
      return
    }

    val thread = Thread({
      try {
        connectBlocking()
        onResult(null)
        pumpOutput()
      } catch (err: Throwable) {
        val message = describe(err)
        if (!closed.get()) {
          events.onStatus(params.sessionId, SSHStatus.ERROR)
          events.onError(params.sessionId, message)
        }
        onResult(message)
        close(1)
      }
    }, "sshbond-${params.sessionId}")

    thread.isDaemon = true
    readerThread = thread
    thread.start()
  }

  private fun connectBlocking() {
    if (!params.proxyJump.isNullOrBlank() && params.jumps.isEmpty()) {
      // Silently ignoring ProxyJump would open a direct connection to a host the
      // user believes is only reachable through a bastion.
      throw UnsupportedOperationException(
        "ProxyJump \"${params.proxyJump}\" was not resolved to a host to jump through."
      )
    }

    events.onStatus(params.sessionId, SSHStatus.CONNECTING)

    val session = openSession(dialAddress = connectJumpChain(), target = targetHop())
    this.session = session

    events.onStatus(params.sessionId, SSHStatus.AUTHENTICATING)

    startForwards(session)

    val channel = openChannel(session)
    this.channel = channel

    // Both streams must be claimed *before* connect(). JSch wires the channel's
    // plumbing at connect time, so a stream requested afterwards misses
    // everything already sent -- the login banner and first prompt for a shell,
    // and the entire output of a short-lived RemoteCommand.
    stdin = channel.getOutputStream()
    stdout = channel.getInputStream()
    stderr = channel.getExtInputStream()

    channel.connect(params.timeoutMs)

    events.onStatus(params.sessionId, SSHStatus.CONNECTED)
  }

  /**
   * Logs into each jump host in turn, every one of them through the one before,
   * and returns the address the target session should dial -- null when there
   * is no chain and the target is reached directly.
   *
   * Each hop is entered through a local forward on its predecessor, so from the
   * second hop onwards the address a socket is opened to is 127.0.0.1 and says
   * nothing about which machine is being authenticated. That is tracked apart
   * from the address, and is what each host key is checked against.
   */
  private fun connectJumpChain(): Address? {
    var entry: Address? = null

    for ((index, hop) in params.jumps.withIndex()) {
      val hopSession = openSession(dialAddress = entry, target = hop)
      jumpSessions.add(hopSession)

      val next = params.jumps.getOrNull(index + 1)
      val nextHost = next?.hostname ?: params.hostname
      val nextPort = next?.port ?: params.port

      entry = Address(
        LOOPBACK,
        hopSession.setPortForwardingL(LOOPBACK, 0, nextHost, nextPort)
      )
    }

    return entry
  }

  /**
   * Opens and authenticates one session.
   *
   * [dialAddress] is where the socket goes; [target] is the machine that is
   * being logged into, which is what the host key is verified against and whose
   * credential is used.
   */
  private fun openSession(dialAddress: Address?, target: SSHJumpHost): Session {
    val address = dialAddress ?: Address(target.hostname, target.port)

    // Every hop gets a JSch of its own: identities are registered per instance,
    // and one machine's key has no business being offered to the next.
    val jsch = JSch()

    // Our repository *is* the host key policy: it hands every key to JavaScript,
    // which has already applied StrictHostKeyChecking and the known-hosts store.
    jsch.hostKeyRepository = DelegatingHostKeyRepository(target.hostname, target.port)

    val session = jsch.getSession(target.username, address.host, address.port)

    // With our repository answering, "yes" means JSch aborts on anything we do
    // not explicitly approve.
    session.setConfig("StrictHostKeyChecking", "yes")
    session.setConfig("PreferredAuthentications", "publickey,keyboard-interactive,password")

    if (params.compression) {
      session.setConfig("compression.s2c", "zlib@openssh.com,zlib,none")
      session.setConfig("compression.c2s", "zlib@openssh.com,zlib,none")
      session.setConfig("compression_level", "6")
    }

    if (params.keepAliveIntervalSeconds > 0) {
      session.serverAliveInterval = params.keepAliveIntervalSeconds * 1000
      session.serverAliveCountMax = params.keepAliveCountMax
    }

    when (target.authType) {
      SSHAuthType.PASSWORD -> {
        // The byte[] overload is the non-deprecated one, and keeps the password
        // out of the String pool where it would linger until GC.
        session.setPassword((target.password ?: "").toByteArray(StandardCharsets.UTF_8))
        session.userInfo = PasswordUserInfo(target.password ?: "")
      }
      SSHAuthType.KEY -> {
        val privateKey = target.privateKey
          ?: throw IllegalArgumentException(
            "Key authentication was requested for ${target.hostname} without a private key."
          )
        jsch.addIdentity(
          "sshbond-${params.sessionId}-${target.hostname}",
          privateKey.toByteArray(StandardCharsets.UTF_8),
          null,
          target.passphrase?.toByteArray(StandardCharsets.UTF_8)
        )
        session.userInfo = PasswordUserInfo(null)
      }
      SSHAuthType.NONE -> {
        session.userInfo = PasswordUserInfo(null)
      }
    }

    // JSch runs host key verification inside connect(); it returns only once the
    // key has been accepted and authentication has succeeded.
    session.connect(params.timeoutMs)

    return session
  }

  /** The target expressed as a hop, so one code path opens every session. */
  private fun targetHop() = SSHJumpHost(
    hostname = params.hostname,
    port = params.port,
    username = params.username,
    authType = params.authType,
    password = params.password,
    privateKey = params.privateKey,
    passphrase = params.passphrase
  )

  /**
   * Brings up the declared port forwards, which OpenSSH also does after
   * authentication and before the shell.
   *
   * A forward that fails is reported on its own tunnel and does not take the
   * session down with it: losing the shell because one of several forwarded
   * ports was already in use is not what `ssh` does, and would leave the user
   * with no way to fix the rule.
   */
  private fun startForwards(session: Session) {
    if (params.forwards.isEmpty()) return

    val forwards = SSHPortForwards(params.sessionId, session, events, params.timeoutMs)
    this.forwards = forwards
    forwards.start(params.forwards)
  }

  private fun openChannel(session: Session): Channel {
    val wantsTty = params.requestTTY != "no"
    val command = params.remoteCommand

    return if (command.isNullOrBlank()) {
      (session.openChannel("shell") as ChannelShell).apply {
        setPty(wantsTty)
        setPtyType(PTY_TYPE)
        setPtySize(DEFAULT_COLS, DEFAULT_ROWS, 0, 0)
        resizePtyHandler = { cols, rows -> setPtySize(cols, rows, 0, 0) }
      }
    } else {
      (session.openChannel("exec") as ChannelExec).apply {
        setCommand(command)
        setPty(wantsTty)
        setPtyType(PTY_TYPE)
        setPtySize(DEFAULT_COLS, DEFAULT_ROWS, 0, 0)
        resizePtyHandler = { cols, rows -> setPtySize(cols, rows, 0, 0) }
      }
    }
  }

  /**
   * Streams channel output until it ends, then closes the session.
   *
   * With a PTY the server merges stderr into the main stream, but a session
   * opened with `RequestTTY no` keeps them apart, so the extended stream is
   * drained on its own thread rather than being dropped.
   */
  private fun pumpOutput() {
    val channel = this.channel ?: return
    val stdout = this.stdout ?: return

    val stderrPump = this.stderr?.let { extStream ->
      Thread({ drain(extStream) }, "sshbond-${params.sessionId}-stderr").apply {
        isDaemon = true
        start()
      }
    }

    drain(stdout)

    // Give stderr a moment to flush what the server already sent.
    stderrPump?.join(500)

    close(channel.exitStatus.takeIf { it >= 0 } ?: 0)
  }

  /** Reads one stream to exhaustion, emitting decoded text as it arrives. */
  private fun drain(stream: InputStream) {
    val buffer = ByteArray(READ_BUFFER_BYTES)
    val decoder = IncrementalUtf8Decoder()

    try {
      while (!closed.get()) {
        val read = stream.read(buffer)
        if (read < 0) break
        if (read > 0) {
          val text = decoder.decode(buffer, read)
          if (text.isNotEmpty()) {
            events.onData(params.sessionId, text)
          }
        }
      }

      val tail = decoder.flush()
      if (tail.isNotEmpty()) {
        events.onData(params.sessionId, tail)
      }
    } catch (err: Throwable) {
      if (!closed.get()) {
        events.onError(params.sessionId, describe(err))
      }
    }
  }

  fun sendData(data: String) {
    val out = stdin ?: throw IllegalStateException("Session ${params.sessionId} is not writable.")
    out.write(data.toByteArray(StandardCharsets.UTF_8))
    out.flush()
  }

  fun resizePty(cols: Int, rows: Int) {
    // A resize arriving after the channel closed is routine, not an error.
    val channel = this.channel ?: return
    if (!channel.isConnected) return
    resizePtyHandler?.invoke(cols, rows)
  }

  /** Answers a pending host key prompt. Extra answers are ignored. */
  fun provideHostKeyDecision(accepted: Boolean) {
    hostKeyDecision.offer(accepted)
  }

  fun close(exitCode: Int = 0) {
    if (!closed.compareAndSet(false, true)) return

    // Unblock a handshake still waiting on a decision that will never come.
    hostKeyDecision.offer(false)

    // Before the session goes: the SOCKS listeners are ours to close, and a
    // stale one would keep the port bound after the session is gone.
    try {
      forwards?.close()
    } catch (_: Throwable) {
      // Already gone.
    }

    try {
      channel?.disconnect()
    } catch (_: Throwable) {
      // Already gone.
    }
    try {
      session?.disconnect()
    } catch (_: Throwable) {
      // Already gone.
    }

    // Reverse order: a jump session still carries the one after it.
    for (jumpSession in jumpSessions.asReversed()) {
      try {
        jumpSession.disconnect()
      } catch (_: Throwable) {
        // Already gone.
      }
    }
    jumpSessions.clear()

    channel = null
    session = null
    forwards = null
    stdin = null
    stdout = null
    stderr = null
    resizePtyHandler = null

    events.onStatus(params.sessionId, SSHStatus.DISCONNECTED)
    events.onClose(params.sessionId, exitCode)
  }

  val isClosed: Boolean get() = closed.get()

  /**
   * Hands every host key to JavaScript and blocks the handshake until it
   * answers. Returning anything other than OK makes JSch abort the connection.
   */
  private inner class DelegatingHostKeyRepository(
    private val logicalHost: String,
    private val logicalPort: Int
  ) : HostKeyRepository {
    override fun check(host: String?, key: ByteArray?): Int {
      if (key == null) return HostKeyRepository.NOT_INCLUDED

      events.onStatus(params.sessionId, SSHStatus.VERIFYING_HOST)

      // Only answers to *this* question may be read. A decision that arrived
      // too late for a previous hop must never be spent on the next one.
      hostKeyDecision.clear()

      val hostKey = HostKey(host, key)
      val encoded = Base64.getEncoder().encodeToString(key)

      events.onHostKey(
        params.sessionId,
        SSHPresentedHostKey(
          hostname = logicalHost,
          port = logicalPort,
          algorithm = hostKey.type,
          fingerprint = sha256Fingerprint(key),
          publicKey = "${hostKey.type} $encoded"
        )
      )

      val accepted = try {
        hostKeyDecision.poll(HOST_KEY_DECISION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        false
      }

      // A timeout (null) is a refusal: never continue with an unanswered key.
      return if (accepted == true) HostKeyRepository.OK else HostKeyRepository.NOT_INCLUDED
    }

    // Trust is persisted on the JavaScript side, in the known-hosts store, so
    // this repository intentionally keeps nothing.
    override fun add(hostkey: HostKey?, ui: UserInfo?) = Unit
    override fun remove(host: String?, type: String?) = Unit
    override fun remove(host: String?, type: String?, key: ByteArray?) = Unit
    override fun getKnownHostsRepositoryID(): String = "sshbond"
    override fun getHostKey(): Array<HostKey> = emptyArray()
    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
  }

  /**
   * JSch asks for confirmations through this interface. Host keys are handled by
   * the repository above, so the only job here is to supply the password and to
   * refuse anything we were not asked to decide.
   */
  private class PasswordUserInfo(private val password: String?) : UserInfo {
    override fun getPassphrase(): String? = null
    override fun getPassword(): String? = password
    override fun promptPassword(message: String?): Boolean = password != null
    override fun promptPassphrase(message: String?): Boolean = false
    override fun promptYesNo(message: String?): Boolean = false
    override fun showMessage(message: String?) = Unit
  }
}

/**
 * Turns a throwable into a message worth showing in the terminal UI. JSch nests
 * the useful detail in the cause, so a bare `message` is often just "session is
 * down" with no indication of why.
 */
internal fun describe(err: Throwable): String {
  val base = err.message?.takeIf { it.isNotBlank() } ?: err.javaClass.simpleName
  val cause = err.cause?.message?.takeIf { it.isNotBlank() && it != base }
  return if (cause != null) "$base: $cause" else base
}

/** `ssh-keygen -l` style fingerprint: unpadded base64 of the SHA-256 digest. */
internal fun sha256Fingerprint(keyBlob: ByteArray): String {
  val digest = MessageDigest.getInstance("SHA-256").digest(keyBlob)
  return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
}

/**
 * Decodes PTY output to text across chunk boundaries.
 *
 * A read can end in the middle of a multi-byte character; decoding each chunk
 * independently would turn that into replacement characters and corrupt any
 * non-ASCII output. Undecoded trailing bytes are carried into the next read.
 */
internal class IncrementalUtf8Decoder {
  private val decoder = StandardCharsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPLACE)
    .onUnmappableCharacter(CodingErrorAction.REPLACE)

  private var pending = ByteBuffer.allocate(0)

  fun decode(chunk: ByteArray, length: Int): String {
    val input = ByteBuffer.allocate(pending.remaining() + length).apply {
      put(pending)
      put(chunk, 0, length)
      flip()
    }

    val output = CharBuffer.allocate(input.remaining() + 1)
    decoder.decode(input, output, false)
    output.flip()

    pending = ByteBuffer.allocate(input.remaining()).apply {
      put(input)
      flip()
    }

    return output.toString()
  }

  /** Flushes whatever remains once the stream has ended. */
  fun flush(): String {
    val output = CharBuffer.allocate(pending.remaining() + 1)
    decoder.decode(pending, output, true)
    decoder.flush(output)
    output.flip()
    pending = ByteBuffer.allocate(0)
    return output.toString()
  }
}
