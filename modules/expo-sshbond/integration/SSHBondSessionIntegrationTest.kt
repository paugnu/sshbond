@file:JvmName("SSHBondEngineIntegration")

import expo.modules.sshbond.SSHAuthType
import expo.modules.sshbond.SSHBondEventSink
import expo.modules.sshbond.SSHBondSession
import expo.modules.sshbond.SSHConnectParams
import expo.modules.sshbond.SSHForwardSpec
import expo.modules.sshbond.SSHForwardType
import expo.modules.sshbond.SSHJumpHost
import expo.modules.sshbond.SSHPresentedHostKey
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.ConnectException
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Drives SSHBondSession against a real sshd. Not a unit test: this is the only
 * way to know the handshake, PTY and host key gating actually behave.
 */
class TunnelReport(val status: String, val boundPort: Int?, val message: String?)

class Recorder : SSHBondEventSink {
  val statuses = ConcurrentLinkedQueue<String>()
  val output = StringBuilder()
  val errors = ConcurrentLinkedQueue<String>()
  val hostKeys = ConcurrentLinkedQueue<SSHPresentedHostKey>()
  val tunnels = ConcurrentHashMap<String, TunnelReport>()
  val closed = CountDownLatch(1)
  val connected = CountDownLatch(1)
  val hostKeySeen = CountDownLatch(1)

  override fun onStatus(sessionId: String, status: String) {
    statuses.add(status)
    if (status == "connected") connected.countDown()
  }

  override fun onData(sessionId: String, data: String) {
    synchronized(output) { output.append(data) }
  }

  override fun onError(sessionId: String, message: String) {
    errors.add(message)
  }

  override fun onClose(sessionId: String, exitCode: Int) {
    closed.countDown()
  }

  override fun onHostKey(sessionId: String, hostKey: SSHPresentedHostKey) {
    hostKeys.add(hostKey)
    hostKeySeen.countDown()
  }

  override fun onTunnel(
    sessionId: String,
    tunnelId: String,
    status: String,
    boundPort: Int?,
    message: String?
  ) {
    tunnels[tunnelId] = TunnelReport(status, boundPort, message)
  }

  fun text(): String = synchronized(output) { output.toString() }

  /** Tunnel events arrive on the session thread, after connect() has returned. */
  fun awaitTunnel(id: String, timeoutMs: Long = 15_000): TunnelReport? {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      tunnels[id]?.let { return it }
      Thread.sleep(50)
    }
    return null
  }
}

var failures = 0

fun check(label: String, condition: Boolean, detail: String = "") {
  if (condition) {
    println("  PASS  $label")
  } else {
    failures++
    println("  FAIL  $label ${if (detail.isNotEmpty()) "-> $detail" else ""}")
  }
}

fun params(
  dir: String,
  sessionId: String,
  command: String? = null,
  forwards: List<SSHForwardSpec> = emptyList(),
  jumps: List<SSHJumpHost> = emptyList()
) = SSHConnectParams(
  sessionId = sessionId,
  hostname = "127.0.0.1",
  port = 2222,
  username = System.getProperty("user.name"),
  authType = SSHAuthType.KEY,
  privateKey = File("$dir/client_key").readText(),
  timeoutMs = 15000,
  keepAliveIntervalSeconds = 30,
  requestTTY = "yes",
  remoteCommand = command,
  forwards = forwards,
  jumps = jumps
)

/**
 * A jump host pointing at the same throwaway sshd. Chaining a server to itself
 * is a real chain: each hop is a separate SSH session, and every one but the
 * first is dialled through a local forward on its predecessor.
 */
fun jumpHost(dir: String) = SSHJumpHost(
  hostname = "127.0.0.1",
  port = 2222,
  username = System.getProperty("user.name"),
  authType = SSHAuthType.KEY,
  privateKey = File("$dir/client_key").readText()
)

/** Reads whatever the peer sends first, which is all these checks need. */
fun readGreeting(socket: Socket, timeoutMs: Int = 10_000): String {
  socket.soTimeout = timeoutMs
  val buffer = ByteArray(256)
  val read = socket.getInputStream().read(buffer)
  return if (read > 0) String(buffer, 0, read, StandardCharsets.UTF_8) else ""
}

fun readFully(input: InputStream, buffer: ByteArray) {
  var offset = 0
  while (offset < buffer.size) {
    val read = input.read(buffer, offset, buffer.size - offset)
    if (read < 0) throw java.io.IOException("stream ended after $offset of ${buffer.size} bytes")
    offset += read
  }
}

/**
 * A SOCKS5 client, so the `-D` listener is exercised the way a browser would:
 * greeting, then a CONNECT by domain name. Returns null when the proxy refused.
 */
fun socks5Connect(proxyPort: Int, host: String, port: Int): Socket? {
  val socket = Socket("127.0.0.1", proxyPort)
  socket.soTimeout = 10_000

  val output = socket.getOutputStream()
  val input = socket.getInputStream()

  output.write(byteArrayOf(0x05, 0x01, 0x00))
  output.flush()

  val greeting = ByteArray(2)
  readFully(input, greeting)
  if (greeting[0].toInt() != 0x05 || greeting[1].toInt() != 0x00) {
    socket.close()
    return null
  }

  val hostBytes = host.toByteArray(StandardCharsets.UTF_8)
  val request = ByteArrayOutputStream()
  request.write(byteArrayOf(0x05, 0x01, 0x00, 0x03))
  request.write(hostBytes.size)
  request.write(hostBytes)
  request.write((port shr 8) and 0xFF)
  request.write(port and 0xFF)
  output.write(request.toByteArray())
  output.flush()

  // version, reply, reserved, address type, IPv4, port
  val reply = ByteArray(10)
  readFully(input, reply)
  if (reply[1].toInt() != 0x00) {
    socket.close()
    return null
  }

  return socket
}

/**
 * Approves each host key as it is presented. Every machine in a chain is vetted
 * on its own, so a chain of n hops asks n + 1 times.
 */
fun approveEachHostKey(session: SSHBondSession, rec: Recorder, expected: Int): Int {
  var approved = 0
  val deadline = System.currentTimeMillis() + 30_000

  while (approved < expected && System.currentTimeMillis() < deadline) {
    if (rec.hostKeys.size > approved) {
      session.provideHostKeyDecision(true)
      approved++
    } else {
      Thread.sleep(50)
    }
  }

  return approved
}

fun main(args: Array<String>) {
  val dir = args[0]
  val expectedFingerprint = args[1]

  println("\n== 1. Host key is presented before authentication, and gates the handshake ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s1"), rec)
    val result = arrayOfNulls<String>(1)
    val settled = CountDownLatch(1)

    session.start { err -> result[0] = err; settled.countDown() }

    check("host key event arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    val key = rec.hostKeys.firstOrNull()
    check("fingerprint matches ssh-keygen", key?.fingerprint == expectedFingerprint,
      "got ${key?.fingerprint} want $expectedFingerprint")
    check("algorithm is reported", key?.algorithm == "ssh-ed25519", "got ${key?.algorithm}")
    check("public key is a full authorized_keys line", key?.publicKey?.startsWith("ssh-ed25519 AAAA") == true)

    // The handshake must still be blocked: nothing has been approved yet.
    check("handshake is blocked awaiting the decision", !rec.connected.await(1, TimeUnit.SECONDS))
    check("status reached verifying_host", rec.statuses.contains("verifying_host"))

    session.provideHostKeyDecision(true)

    check("connects once the key is approved", rec.connected.await(15, TimeUnit.SECONDS))
    check("connect promise settles without error", settled.await(5, TimeUnit.SECONDS) && result[0] == null,
      "err=${result[0]}")
    check("status order is sane",
      rec.statuses.toList().let {
        it.indexOf("connecting") < it.indexOf("verifying_host") &&
          it.indexOf("verifying_host") < it.indexOf("connected")
      },
      rec.statuses.toList().toString())

    println("\n== 2. Interactive PTY: shell, commands, UTF-8, resize ==")
    Thread.sleep(1500)
    session.sendData("printf 'INTERACTIVE_%s\\n' OK\n")
    Thread.sleep(1500)
    check("shell executed a command", rec.text().contains("INTERACTIVE_OK"), rec.text().takeLast(200))

    session.sendData("printf '%s %s %s\\n' 'ünïcödé' '🔐' 'ok'\n")
    Thread.sleep(1500)
    check("multi-byte UTF-8 survives chunking", rec.text().contains("ünïcödé 🔐 ok"))

    // A real PTY is what makes ncurses apps work; stty proves one is attached.
    session.sendData("tty | grep -q /dev/pts && printf 'PTY_%s\\n' ATTACHED\n")
    Thread.sleep(1500)
    check("a PTY is allocated", rec.text().contains("PTY_ATTACHED"))

    session.resizePty(132, 43)
    Thread.sleep(800)
    session.sendData("stty size\n")
    Thread.sleep(1500)
    check("PTY resize reached the server", rec.text().contains("43 132"), rec.text().takeLast(200))

    println("\n== 3. Disconnect ==")
    session.close(0)
    check("close event fires", rec.closed.await(10, TimeUnit.SECONDS))
    check("status ends disconnected", rec.statuses.last() == "disconnected", rec.statuses.last())
    check("session reports itself closed", session.isClosed)
  }

  println("\n== 4. Refusing the host key aborts the connection ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s2"), rec)
    val result = arrayOfNulls<String>(1)
    val settled = CountDownLatch(1)

    session.start { err -> result[0] = err; settled.countDown() }
    check("host key event arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))

    session.provideHostKeyDecision(false)

    check("connect fails", settled.await(15, TimeUnit.SECONDS) && result[0] != null, "err=${result[0]}")
    check("never reports connected", !rec.statuses.contains("connected"), rec.statuses.toList().toString())
    check("error mentions the host key", result[0]?.contains("HostKey", ignoreCase = true) == true ||
      result[0]?.contains("reject", ignoreCase = true) == true, "err=${result[0]}")
  }

  println("\n== 5. Wrong key is rejected by the server ==")
  run {
    val rec = Recorder()
    val bogus = File("$dir/bogus_key").readText()
    val session = SSHBondSession(params(dir, "s3").copy(privateKey = bogus), rec)
    val result = arrayOfNulls<String>(1)
    val settled = CountDownLatch(1)

    session.start { err -> result[0] = err; settled.countDown() }
    check("host key event arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    session.provideHostKeyDecision(true)

    check("authentication fails", settled.await(15, TimeUnit.SECONDS) && result[0] != null, "err=${result[0]}")
    check("error mentions auth", result[0]?.contains("Auth", ignoreCase = true) == true, "err=${result[0]}")
    check("never reports connected", !rec.statuses.contains("connected"))
  }

  println("\n== 6. RemoteCommand runs instead of a shell ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s4", command = "echo REMOTE_COMMAND_OK"), rec)
    val settled = CountDownLatch(1)
    session.start { settled.countDown() }

    check("host key event arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    session.provideHostKeyDecision(true)
    check("connects", rec.connected.await(15, TimeUnit.SECONDS))
    check("closes on its own when the command ends", rec.closed.await(15, TimeUnit.SECONDS))
    check("command output was streamed", rec.text().contains("REMOTE_COMMAND_OK"), rec.text().takeLast(200))
  }

  println("\n== 7. An unresolved ProxyJump is refused rather than silently ignored ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s5").copy(proxyJump = "bastion.example.com"), rec)
    val result = arrayOfNulls<String>(1)
    val settled = CountDownLatch(1)

    session.start { err -> result[0] = err; settled.countDown() }
    check("fails fast", settled.await(10, TimeUnit.SECONDS) && result[0] != null)
    check("error names ProxyJump", result[0]?.contains("ProxyJump") == true, "err=${result[0]}")
    check("no connection was attempted", rec.hostKeys.isEmpty())
  }

  println("\n== 8. Port forwarding: -L, -R, -D ==")
  run {
    // Stands in for the service a `-R` forward exposes to the server.
    val greeter = ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"))
    Thread({
      while (true) {
        val client = try { greeter.accept() } catch (_: Exception) { break }
        Thread({
          client.use { it.getOutputStream().write("SSHBOND_REMOTE_OK\n".toByteArray()) }
        }).apply { isDaemon = true }.start()
      }
    }).apply { isDaemon = true }.start()

    val rec = Recorder()
    val session = SSHBondSession(
      params(
        dir, "s6",
        forwards = listOf(
          // Forwarded to sshd itself: its banner proves bytes really crossed.
          SSHForwardSpec("t-local", SSHForwardType.LOCAL, null, 0, "127.0.0.1", 2222),
          SSHForwardSpec("t-remote", SSHForwardType.REMOTE, null, 0, "127.0.0.1", greeter.localPort),
          SSHForwardSpec("t-dynamic", SSHForwardType.DYNAMIC, null, 0),
          // Already taken by the greeter above, so it cannot be bound.
          SSHForwardSpec("t-bad", SSHForwardType.LOCAL, null, greeter.localPort, "127.0.0.1", 2222)
        )
      ),
      rec
    )

    session.start { }
    check("host key event arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    session.provideHostKeyDecision(true)
    check("connects", rec.connected.await(15, TimeUnit.SECONDS))

    val local = rec.awaitTunnel("t-local")
    check("-L reports active", local?.status == "active", "got ${local?.status} ${local?.message}")
    check("-L reports the allocated port", (local?.boundPort ?: 0) > 0, "port=${local?.boundPort}")

    val remote = rec.awaitTunnel("t-remote")
    check("-R reports active", remote?.status == "active", "got ${remote?.status} ${remote?.message}")
    check("-R reports the port the server allocated", (remote?.boundPort ?: 0) > 0, "port=${remote?.boundPort}")

    val dynamic = rec.awaitTunnel("t-dynamic")
    check("-D reports active", dynamic?.status == "active", "got ${dynamic?.status} ${dynamic?.message}")
    check("-D reports the allocated port", (dynamic?.boundPort ?: 0) > 0, "port=${dynamic?.boundPort}")

    val bad = rec.awaitTunnel("t-bad")
    check("an unbindable -L is reported as an error", bad?.status == "error", "got ${bad?.status}")
    check("the error says what went wrong", bad?.message?.isNotBlank() == true, "msg=${bad?.message}")

    // A forward that failed must not take the shell down with it.
    session.sendData("printf 'FORWARD_FAILURE_%s\\n' SURVIVED\n")
    Thread.sleep(1500)
    check("the session survives a failed forward", rec.text().contains("FORWARD_FAILURE_SURVIVED"))

    check("-L carries traffic", Socket("127.0.0.1", local?.boundPort ?: 0).use {
      readGreeting(it).startsWith("SSH-")
    })

    check("-R carries traffic back", Socket("127.0.0.1", remote?.boundPort ?: 0).use {
      readGreeting(it).contains("SSHBOND_REMOTE_OK")
    })

    val proxied = socks5Connect(dynamic?.boundPort ?: 0, "127.0.0.1", 2222)
    check("-D proxies a SOCKS5 CONNECT", proxied != null)
    if (proxied != null) {
      check("-D carries traffic", proxied.use { readGreeting(it).startsWith("SSH-") })
    }

    // Answering "granted" and then dropping the socket would leave the client
    // waiting on a connection that was never made.
    check(
      "-D refuses a connection the server will not make",
      socks5Connect(dynamic?.boundPort ?: 0, "127.0.0.1", 1) == null
    )

    session.close(0)
    check("close event fires", rec.closed.await(10, TimeUnit.SECONDS))

    // The SOCKS listener is ours to close; JSch never knew about it.
    Thread.sleep(500)
    val socksPortReleased = try {
      Socket("127.0.0.1", dynamic?.boundPort ?: 0).close()
      false
    } catch (_: ConnectException) {
      true
    }
    check("-D stops listening once the session ends", socksPortReleased)

    greeter.close()
  }

  println("\n== 9. ProxyJump: every hop is authenticated and vetted in turn ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(
      params(dir, "s7", command = "echo JUMPED_OK", jumps = listOf(jumpHost(dir))),
      rec
    )
    val settled = CountDownLatch(1)
    session.start { settled.countDown() }

    // The bastion's key comes first: it is the machine actually being dialled.
    check("the jump host's key is presented", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    check("nothing is connected yet", !rec.connected.await(1, TimeUnit.SECONDS))

    // Two machines to vet, and neither is authenticated before its key is.
    approveEachHostKey(session, rec, expected = 2)

    check("connects through the jump host", rec.connected.await(20, TimeUnit.SECONDS))
    check("a key was presented for each machine", rec.hostKeys.size == 2, "got ${rec.hostKeys.size}")
    check(
      "every key names the machine it belongs to, never the local forward",
      rec.hostKeys.all { it.hostname == "127.0.0.1" && it.port == 2222 },
      rec.hostKeys.joinToString { "${it.hostname}:${it.port}" }
    )
    check("the command ran on the far end", rec.closed.await(15, TimeUnit.SECONDS) &&
      rec.text().contains("JUMPED_OK"), rec.text().takeLast(200))
    check("connect reported no error", settled.await(5, TimeUnit.SECONDS))
  }

  println("\n== 10. A two-hop chain is traversed in order ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(
      params(dir, "s8", command = "echo TWO_HOPS_OK", jumps = listOf(jumpHost(dir), jumpHost(dir))),
      rec
    )
    session.start { }

    // Three machines to vet: two bastions and the target.
    val approvals = approveEachHostKey(session, rec, expected = 3)

    check("every hop asked before authenticating", approvals == 3, "approved $approvals")
    check("connects through both hops", rec.connected.await(20, TimeUnit.SECONDS))
    check("the command ran on the far end", rec.closed.await(15, TimeUnit.SECONDS) &&
      rec.text().contains("TWO_HOPS_OK"), rec.text().takeLast(200))
    check("no errors were reported", rec.errors.isEmpty(), rec.errors.toList().toString())
  }

  println("\n== 11. Encrypted private key authentication ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s9", command = "printf ENCRYPTED_KEY_OK").copy(
      privateKey = File("$dir/client_key_encrypted").readText(),
      passphrase = "sshbond-integration-only"
    ), rec)
    session.start { }
    check("encrypted key: host key arrives", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    session.provideHostKeyDecision(true)
    check("encrypted key authenticates and executes remotely", rec.closed.await(20, TimeUnit.SECONDS) &&
      rec.text().contains("ENCRYPTED_KEY_OK"), rec.errors.toList().toString())
    session.close(0)
  }

  println("\n== 12. Incorrect private key passphrase ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s10").copy(
      privateKey = File("$dir/client_key_encrypted").readText(), passphrase = "incorrect"
    ), rec)
    val settled = CountDownLatch(1)
    var failure: String? = null
    session.start { error -> failure = error; settled.countDown() }
    // An implementation may validate/decrypt the key before opening the socket.
    val deadline = System.currentTimeMillis() + 15_000
    while (rec.hostKeys.isEmpty() && settled.count > 0 && System.currentTimeMillis() < deadline) Thread.sleep(20)
    if (rec.hostKeys.isNotEmpty()) session.provideHostKeyDecision(true)
    check("wrong passphrase fails", settled.await(15, TimeUnit.SECONDS) && failure != null)
    check("wrong passphrase never connects", !rec.statuses.contains("connected"))
    session.close(0)
  }

  println("\n== 13. Disconnect while host approval is pending ==")
  run {
    val rec = Recorder()
    val session = SSHBondSession(params(dir, "s11"), rec)
    val settled = CountDownLatch(1)
    session.start { settled.countDown() }
    check("pending approval reaches real server", rec.hostKeySeen.await(15, TimeUnit.SECONDS))
    session.close(0)
    check("cancel closes the connection", rec.closed.await(5, TimeUnit.SECONDS))
    check("cancel settles the connect operation", settled.await(5, TimeUnit.SECONDS))
    session.provideHostKeyDecision(true)
    check("late approval cannot connect", !rec.statuses.contains("connected"))
  }

  println("\n${if (failures == 0) "ALL CHECKS PASSED" else "$failures CHECK(S) FAILED"}")
  System.exit(if (failures == 0) 0 else 1)
}
