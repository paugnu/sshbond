import Foundation

final class ProbeSink: SSHBondEventSink {
  weak var session: SSHBondSession?
  var verified = false
  var output = ""
  var expectedFingerprint: String?
  let closed = DispatchSemaphore(value: 0)
  func onStatus(sessionId: String, status: String) { print("PROBE status=\(status)") }
  func onData(sessionId: String, data: String) { output += data }
  func onError(sessionId: String, message: String) { print("PROBE error=\(message)") }
  func onClose(sessionId: String, exitCode: Int) { closed.signal() }
  func onHostKey(sessionId: String, hostKey: SSHPresentedHostKey) {
    verified = true
    print("PROBE handshake verified; host key=\(hostKey.algorithm)")
    session?.provideHostKeyDecision(expectedFingerprint != nil && expectedFingerprint == hostKey.fingerprint)
  }
  func onTunnel(sessionId: String, tunnelId: String, status: String, boundPort: Int?, message: String?) {}
}
let args = CommandLine.arguments
let authenticate = args.count == 6
let sink = ProbeSink()
if authenticate { sink.expectedFingerprint = args[5] }
let key = authenticate ? try String(contentsOfFile: args[4], encoding: .utf8) : nil
let params = SSHConnectParams(sessionId: "probe", hostname: args[1], port: authenticate ? Int(args[2])! : 22, username: authenticate ? args[3] : "probe", authType: authenticate ? .key : .none, password: nil, privateKey: key, passphrase: nil, timeoutMs: 30000, compression: false, keepAliveIntervalSeconds: 2400, keepAliveCountMax: 3, proxyJump: nil, requestTTY: "no", remoteCommand: authenticate ? "printf SSHBOND_PROBE_OK" : nil, forwards: [], jumps: [])
let session = SSHBondSession(params: params, events: sink)
sink.session = session
let done = DispatchSemaphore(value: 0)
var connectError: String?
session.start { message in connectError = message; print("PROBE result=\(message ?? "connected")"); done.signal() }
let result = done.wait(timeout: .now() + 45)
if authenticate {
  let ended = sink.closed.wait(timeout: .now() + 15)
  let passed = result == .success && ended == .success && connectError == nil && sink.output.contains("SSHBOND_PROBE_OK")
  print("PROBE authenticated command passed=\(passed)")
  exit(passed ? 0 : 1)
}
exit(result == .success && sink.verified ? 0 : 1)
