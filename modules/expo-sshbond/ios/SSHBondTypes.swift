import Foundation

/**
 * Everything in this file and in SSHBondSession.swift is plain Foundation with
 * no Expo dependency, mirroring the Android engine: only SSHBondModule.swift
 * binds it to the Expo Modules API.
 */

/// Mirrors the ConnectionStatus union on the TypeScript side.
enum SSHStatus {
  static let connecting = "connecting"
  static let verifyingHost = "verifying_host"
  static let authenticating = "authenticating"
  static let connected = "connected"
  static let error = "error"
  static let disconnected = "disconnected"
}

/// Mirrors the TunnelStatus union on the TypeScript side.
enum SSHTunnelStatus {
  static let active = "active"
  static let error = "error"
  static let stopped = "stopped"
}

enum SSHAuthType {
  case password
  case key
  case none

  static func fromJs(_ value: String?) -> SSHAuthType {
    switch value {
    case "password": return .password
    case "key": return .key
    default: return .none
    }
  }
}

enum SSHForwardType {
  case local
  case remote
  case dynamic

  static func fromJs(_ value: String?) throws -> SSHForwardType {
    switch value {
    case "local": return .local
    case "remote": return .remote
    case "dynamic": return .dynamic
    default: throw SSHBondError.message("Unknown port forward type \"\(value ?? "nil")\".")
    }
  }
}

/// One `-L` / `-R` / `-D` rule. `id` is minted in JavaScript and echoed back.
struct SSHForwardSpec {
  let id: String
  let type: SSHForwardType
  let bindAddress: String?
  let bindPort: Int
  let targetHost: String?
  let targetPort: Int?
}

/// One machine to authenticate to on the way to the target.
struct SSHJumpHost {
  let hostname: String
  let port: Int
  let username: String
  let authType: SSHAuthType
  let password: String?
  let privateKey: String?
  let passphrase: String?
}

struct SSHConnectParams {
  let sessionId: String
  let hostname: String
  let port: Int
  let username: String
  let authType: SSHAuthType
  let password: String?
  let privateKey: String?
  let passphrase: String?
  let timeoutMs: Int
  let compression: Bool
  let keepAliveIntervalSeconds: Int
  let keepAliveCountMax: Int
  let proxyJump: String?
  let requestTTY: String
  let remoteCommand: String?
  let forwards: [SSHForwardSpec]
  let jumps: [SSHJumpHost]
}

/// Host key offered by a server, formatted the way SSHBond stores it.
struct SSHPresentedHostKey {
  /// The machine the key belongs to, never the address the socket went to.
  let hostname: String
  let port: Int
  let algorithm: String
  let fingerprint: String
  let publicKey: String
}

/// Events pushed up to JavaScript.
protocol SSHBondEventSink: AnyObject {
  func onStatus(sessionId: String, status: String)
  func onData(sessionId: String, data: String)
  func onError(sessionId: String, message: String)
  func onClose(sessionId: String, exitCode: Int)
  func onHostKey(sessionId: String, hostKey: SSHPresentedHostKey)
  func onTunnel(sessionId: String, tunnelId: String, status: String, boundPort: Int?, message: String?)
}

enum SSHBondError: Error, LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let text): return text
    }
  }
}
