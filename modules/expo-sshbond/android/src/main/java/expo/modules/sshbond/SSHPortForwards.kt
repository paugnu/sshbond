package expo.modules.sshbond

import com.jcraft.jsch.ChannelDirectTCPIP
import com.jcraft.jsch.Session
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Opens the `-L`, `-R` and `-D` forwards declared for a session and reports
 * what each one actually did.
 *
 * A forward that cannot be established does not abort the session -- OpenSSH
 * keeps the shell too, `ExitOnForwardFailure` being `no` by default -- but the
 * failure is reported per tunnel rather than swallowed. A tunnel drawn as
 * working when nothing is listening sends the user's traffic into a black hole.
 *
 * Like the rest of the engine this is plain JVM Kotlin, so it can be exercised
 * against a real sshd outside of an emulator.
 */
class SSHPortForwards(
  private val sessionId: String,
  private val session: Session,
  private val events: SSHBondEventSink,
  private val connectTimeoutMs: Int
) : Closeable {
  private val socksServers = mutableListOf<SocksProxyServer>()
  private val closed = AtomicBoolean(false)

  /** Establishes every rule, reporting each one independently of the others. */
  fun start(specs: List<SSHForwardSpec>) {
    for (spec in specs) {
      try {
        val boundPort = when (spec.type) {
          SSHForwardType.LOCAL -> startLocal(spec)
          SSHForwardType.REMOTE -> startRemote(spec)
          SSHForwardType.DYNAMIC -> startDynamic(spec)
        }
        events.onTunnel(sessionId, spec.id, SSHTunnelStatus.ACTIVE, boundPort, null)
      } catch (err: Throwable) {
        events.onTunnel(sessionId, spec.id, SSHTunnelStatus.ERROR, null, describe(err))
      }
    }
  }

  private fun startLocal(spec: SSHForwardSpec): Int {
    val (host, port) = requireTarget(spec, "-L")
    return session.setPortForwardingL(normaliseBindAddress(spec.bindAddress), spec.bindPort, host, port)
  }

  private fun startRemote(spec: SSHForwardSpec): Int {
    val (host, port) = requireTarget(spec, "-R")
    val bindAddress = normaliseBindAddress(spec.bindAddress)

    // Only the config-string overload reports the port the *server* allocated,
    // which is the entire point of `-R 0:...`. It splits the string on ':', so
    // a literal IPv6 target has to go through the typed overload instead and
    // keeps the port it asked for.
    if (spec.bindPort == 0 && !host.contains(':')) {
      return session.setPortForwardingR("$bindAddress:0:$host:$port")
    }

    session.setPortForwardingR(bindAddress, spec.bindPort, host, port)
    return spec.bindPort
  }

  private fun startDynamic(spec: SSHForwardSpec): Int {
    val server = SocksProxyServer(
      bindAddress = normaliseBindAddress(spec.bindAddress),
      requestedPort = spec.bindPort,
      openChannel = ::openDirectTcpIp
    )

    synchronized(socksServers) {
      if (closed.get()) {
        server.close()
        throw IllegalStateException("The session is closing.")
      }
      socksServers.add(server)
    }

    server.start()
    return server.port
  }

  /**
   * Opens a `direct-tcpip` channel, blocking until the server accepts or
   * refuses it, so the SOCKS layer can answer its client truthfully.
   */
  private fun openDirectTcpIp(host: String, port: Int): ForwardedChannel {
    val channel = session.openChannel("direct-tcpip") as ChannelDirectTCPIP
    channel.setHost(host)
    channel.setPort(port)

    // Both streams are claimed before connect(), as JSch wires the channel's
    // plumbing at connect time. Crucially the channel must *not* be handed an
    // input stream: with one set, JSch opens the channel on a thread of its own
    // and a refused connection could no longer be turned into a SOCKS error
    // reply -- the client would see a successful CONNECT and then a dead socket.
    val fromRemote = channel.inputStream
    val toRemote = channel.outputStream

    channel.connect(connectTimeoutMs)

    return ForwardedChannel(fromRemote, toRemote) { channel.disconnect() }
  }

  private fun requireTarget(spec: SSHForwardSpec, flag: String): Pair<String, Int> {
    val host = spec.targetHost
    val port = spec.targetPort
    if (host.isNullOrBlank() || port == null) {
      throw IllegalArgumentException("$flag ${spec.bindPort} has no target to forward to.")
    }
    return host to port
  }

  /**
   * Local and remote forwards are owned by the JSch session and are torn down
   * with it; the SOCKS listeners are ours and have to be closed by hand.
   */
  override fun close() {
    if (!closed.compareAndSet(false, true)) return

    val servers = synchronized(socksServers) {
      socksServers.toList().also { socksServers.clear() }
    }

    for (server in servers) {
      runCatching { server.close() }
    }
  }
}

/**
 * OpenSSH binds a forward to the loopback interface unless it is asked for
 * something else, and `*` means every interface. Anything else is passed
 * through untouched.
 */
internal fun normaliseBindAddress(address: String?): String {
  val trimmed = address?.trim()
  return when {
    trimmed.isNullOrEmpty() -> LOOPBACK_ADDRESS
    trimmed == "*" -> ANY_ADDRESS
    trimmed.equals("localhost", ignoreCase = true) -> LOOPBACK_ADDRESS
    else -> trimmed
  }
}

private const val LOOPBACK_ADDRESS = "127.0.0.1"
private const val ANY_ADDRESS = "0.0.0.0"

/** One open `direct-tcpip` channel, seen as a pair of streams. */
internal class ForwardedChannel(
  val input: InputStream,
  val output: OutputStream,
  private val disconnect: () -> Unit
) : Closeable {
  override fun close() {
    runCatching { disconnect() }
  }
}

/**
 * The listener behind `-D`: a SOCKS proxy that turns every connection it
 * accepts into its own `direct-tcpip` channel on the SSH session.
 *
 * SOCKS5 and SOCKS4/4a are both answered, as OpenSSH does. No authentication
 * method is offered: the proxy binds to the loopback interface unless the rule
 * explicitly says otherwise, and one reachable from another machine is an open
 * proxy that no password on this hop would make safe.
 */
internal class SocksProxyServer(
  bindAddress: String,
  requestedPort: Int,
  private val openChannel: (String, Int) -> ForwardedChannel
) : Closeable {
  private companion object {
    const val BACKLOG = 32
    const val RELAY_BUFFER_BYTES = 8192
    /** Long enough for a DNS lookup and a greeting; short enough not to pin a thread. */
    const val HANDSHAKE_TIMEOUT_MS = 30_000

    const val SOCKS5 = 0x05
    const val SOCKS4 = 0x04
    const val CMD_CONNECT = 0x01

    const val METHOD_NO_AUTH = 0x00
    const val METHOD_NONE_ACCEPTABLE = 0xFF

    const val ATYP_IPV4 = 0x01
    const val ATYP_DOMAIN = 0x03
    const val ATYP_IPV6 = 0x04

    const val REPLY_SUCCEEDED = 0x00
    const val REPLY_GENERAL_FAILURE = 0x01
    const val REPLY_COMMAND_NOT_SUPPORTED = 0x07
    const val REPLY_ADDRESS_NOT_SUPPORTED = 0x08

    const val SOCKS4_GRANTED = 0x5A
    const val SOCKS4_REJECTED = 0x5B

    const val MAX_DOMAIN_LENGTH = 255
  }

  private val serverSocket = ServerSocket(requestedPort, BACKLOG, InetAddress.getByName(bindAddress))
  private val clients = ConcurrentHashMap.newKeySet<Socket>()
  private val closed = AtomicBoolean(false)

  /** The port actually listened on, which is the allocated one when 0 was asked for. */
  val port: Int get() = serverSocket.localPort

  fun start() {
    Thread({ acceptLoop() }, "sshbond-socks-$port").apply {
      isDaemon = true
      start()
    }
  }

  private fun acceptLoop() {
    while (!closed.get()) {
      val socket = try {
        serverSocket.accept()
      } catch (_: IOException) {
        // close() shuts the listener down; an accept failure is how that arrives.
        break
      }

      Thread({ serve(socket) }, "sshbond-socks-$port-client").apply {
        isDaemon = true
        start()
      }
    }
  }

  private fun serve(socket: Socket) {
    clients.add(socket)
    var channel: ForwardedChannel? = null

    try {
      socket.tcpNoDelay = true
      socket.soTimeout = HANDSHAKE_TIMEOUT_MS

      val input = socket.getInputStream()
      val output = socket.getOutputStream()

      val request = when (input.read()) {
        SOCKS5 -> negotiateSocks5(input, output)
        SOCKS4 -> negotiateSocks4(input, output)
        else -> null
      } ?: return

      channel = try {
        openChannel(request.host, request.port)
      } catch (_: Throwable) {
        writeReply(output, request, granted = false)
        return
      }

      writeReply(output, request, granted = true)

      // The handshake is over; a relayed connection may now idle for as long as
      // its protocol likes.
      socket.soTimeout = 0
      relay(socket, input, output, channel)
    } catch (_: IOException) {
      // A proxy client hanging up mid-handshake is routine, not an error.
    } finally {
      channel?.close()
      clients.remove(socket)
      runCatching { socket.close() }
    }
  }

  /** The version byte has already been read. Returns null when we refused the request. */
  private fun negotiateSocks5(input: InputStream, output: OutputStream): SocksRequest? {
    val methodCount = input.read()
    if (methodCount < 0) return null
    val methods = readFully(input, methodCount)

    if (methods.none { (it.toInt() and 0xFF) == METHOD_NO_AUTH }) {
      output.write(byteArrayOf(SOCKS5.toByte(), METHOD_NONE_ACCEPTABLE.toByte()))
      output.flush()
      return null
    }

    output.write(byteArrayOf(SOCKS5.toByte(), METHOD_NO_AUTH.toByte()))
    output.flush()

    // version, command, reserved, address type
    val header = readFully(input, 4)
    val command = header[1].toInt() and 0xFF

    val host = when (val addressType = header[3].toInt() and 0xFF) {
      ATYP_IPV4 -> InetAddress.getByAddress(readFully(input, 4)).hostAddress
      ATYP_IPV6 -> InetAddress.getByAddress(readFully(input, 16)).hostAddress
      ATYP_DOMAIN -> {
        val length = input.read()
        if (length !in 1..MAX_DOMAIN_LENGTH) return null
        String(readFully(input, length), StandardCharsets.UTF_8)
      }
      else -> {
        writeSocks5Reply(output, REPLY_ADDRESS_NOT_SUPPORTED)
        return null
      }
    }

    // Read the port even when the request is about to be refused, so a client
    // that reuses the connection is not left reading a desynchronised stream.
    val port = readPort(input)

    if (command != CMD_CONNECT) {
      // BIND and UDP ASSOCIATE would need the server to listen on our behalf.
      writeSocks5Reply(output, REPLY_COMMAND_NOT_SUPPORTED)
      return null
    }

    return SocksRequest(SOCKS5, host, port)
  }

  private fun negotiateSocks4(input: InputStream, output: OutputStream): SocksRequest? {
    val command = input.read()
    val port = readPort(input)
    val address = readFully(input, 4)

    // The user id is for authenticating to the *proxy*; we authenticated to the
    // SSH server instead, so it is read to keep the stream aligned and dropped.
    readNullTerminated(input)

    // SOCKS4a signals "the address is really the hostname that follows" with an
    // otherwise invalid 0.0.0.x.
    val isSocks4a = address[0].toInt() == 0 && address[1].toInt() == 0 &&
      address[2].toInt() == 0 && address[3].toInt() != 0

    val host = if (isSocks4a) {
      readNullTerminated(input)
    } else {
      InetAddress.getByAddress(address).hostAddress
    }

    if (command != CMD_CONNECT || host.isEmpty()) {
      writeSocks4Reply(output, SOCKS4_REJECTED)
      return null
    }

    return SocksRequest(SOCKS4, host, port)
  }

  private fun writeReply(output: OutputStream, request: SocksRequest, granted: Boolean) {
    if (request.version == SOCKS5) {
      writeSocks5Reply(output, if (granted) REPLY_SUCCEEDED else REPLY_GENERAL_FAILURE)
    } else {
      writeSocks4Reply(output, if (granted) SOCKS4_GRANTED else SOCKS4_REJECTED)
    }
  }

  /**
   * The bound address in a reply describes the proxy's own side of the relay.
   * A channel has no local socket to name, and 0.0.0.0:0 is what clients expect
   * to see when there is nothing meaningful to report.
   */
  private fun writeSocks5Reply(output: OutputStream, reply: Int) {
    output.write(
      byteArrayOf(
        SOCKS5.toByte(), reply.toByte(), 0x00, ATYP_IPV4.toByte(),
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00
      )
    )
    output.flush()
  }

  private fun writeSocks4Reply(output: OutputStream, reply: Int) {
    output.write(
      byteArrayOf(
        0x00, reply.toByte(),
        0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
      )
    )
    output.flush()
  }

  /**
   * Pumps both directions until either end stops, then tears the pair down.
   *
   * Closing the socket is what unblocks the upstream thread: a read on a socket
   * whose peer has gone quiet does not return on its own, and leaving it parked
   * would leak a thread per proxied connection.
   */
  private fun relay(socket: Socket, input: InputStream, output: OutputStream, channel: ForwardedChannel) {
    val upstream = Thread({
      try {
        copy(input, channel.output)
      } catch (_: IOException) {
        // The client went away; the downstream copy below notices too.
      }
    }, "sshbond-socks-$port-up").apply {
      isDaemon = true
      start()
    }

    try {
      copy(channel.input, output)
    } catch (_: IOException) {
      // The channel ended; fall through to the teardown.
    }

    runCatching { socket.close() }
    upstream.join(500)
  }

  private fun copy(from: InputStream, to: OutputStream) {
    val buffer = ByteArray(RELAY_BUFFER_BYTES)
    while (true) {
      val read = from.read(buffer)
      if (read < 0) break
      if (read > 0) {
        to.write(buffer, 0, read)
        to.flush()
      }
    }
  }

  private fun readFully(input: InputStream, length: Int): ByteArray {
    val buffer = ByteArray(length)
    var offset = 0
    while (offset < length) {
      val read = input.read(buffer, offset, length - offset)
      if (read < 0) throw IOException("The SOCKS client closed the connection mid-handshake.")
      offset += read
    }
    return buffer
  }

  private fun readPort(input: InputStream): Int {
    val bytes = readFully(input, 2)
    return ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
  }

  private fun readNullTerminated(input: InputStream): String {
    val bytes = StringBuilder()
    while (bytes.length <= MAX_DOMAIN_LENGTH) {
      val next = input.read()
      if (next <= 0) break
      bytes.append(next.toChar())
    }
    return bytes.toString()
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return

    runCatching { serverSocket.close() }
    for (client in clients) {
      runCatching { client.close() }
    }
    clients.clear()
  }

  private class SocksRequest(val version: Int, val host: String, val port: Int)
}
