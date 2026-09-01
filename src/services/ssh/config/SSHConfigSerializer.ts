import { SSHHost } from '@/domain/models/sshConfig';

export class SSHConfigSerializer {
  /**
   * Serializes a single SSHHost model into an OpenSSH config block
   */
  public static serializeHost(host: SSHHost, identityFileMap?: Map<string, string>): string {
    const lines: string[] = [];

    lines.push(`Host ${host.alias}`);
    if (host.hostname && host.hostname !== host.alias) {
      lines.push(`    HostName ${host.hostname}`);
    }
    if (host.username) {
      lines.push(`    User ${host.username}`);
    }
    if (host.port && host.port !== 22) {
      lines.push(`    Port ${host.port}`);
    }

    if (host.identityId && identityFileMap && identityFileMap.has(host.identityId)) {
      lines.push(`    IdentityFile ${identityFileMap.get(host.identityId)}`);
    } else if (host.identityId) {
      lines.push(`    IdentityFile ~/.ssh/${host.identityId}`);
    }

    if (host.proxyJump) {
      lines.push(`    ProxyJump ${host.proxyJump}`);
    }
    if (host.proxyCommand) {
      lines.push(`    ProxyCommand ${host.proxyCommand}`);
    }
    if (host.serverAliveInterval !== undefined && host.serverAliveInterval > 0) {
      lines.push(`    ServerAliveInterval ${host.serverAliveInterval}`);
    }
    if (host.serverAliveCountMax !== undefined && host.serverAliveCountMax !== 3) {
      lines.push(`    ServerAliveCountMax ${host.serverAliveCountMax}`);
    }
    if (host.connectTimeout !== undefined) {
      lines.push(`    ConnectTimeout ${host.connectTimeout}`);
    }
    if (host.compression !== undefined) {
      lines.push(`    Compression ${host.compression ? 'yes' : 'no'}`);
    }
    if (host.forwardAgent !== undefined) {
      lines.push(`    ForwardAgent ${host.forwardAgent ? 'yes' : 'no'}`);
    }
    if (host.requestTTY !== undefined && host.requestTTY !== 'auto') {
      lines.push(`    RequestTTY ${host.requestTTY}`);
    }
    if (host.remoteCommand) {
      lines.push(`    RemoteCommand ${host.remoteCommand}`);
    }
    if (host.tcpKeepAlive !== undefined) {
      lines.push(`    TCPKeepAlive ${host.tcpKeepAlive ? 'yes' : 'no'}`);
    }
    if (host.strictHostKeyChecking !== undefined && host.strictHostKeyChecking !== 'ask') {
      lines.push(`    StrictHostKeyChecking ${host.strictHostKeyChecking}`);
    }
    if (host.userKnownHostsFile) {
      lines.push(`    UserKnownHostsFile ${host.userKnownHostsFile}`);
    }

    if (host.localForwards) {
      for (const lf of host.localForwards) {
        const bind = lf.bindAddress ? `${formatAddress(lf.bindAddress)}:` : '';
        lines.push(
          `    LocalForward ${bind}${lf.bindPort} ${formatAddress(lf.targetHost)}:${lf.targetPort}`
        );
      }
    }

    if (host.remoteForwards) {
      for (const rf of host.remoteForwards) {
        const bind = rf.bindAddress ? `${formatAddress(rf.bindAddress)}:` : '';
        lines.push(
          `    RemoteForward ${bind}${rf.bindPort} ${formatAddress(rf.targetHost)}:${rf.targetPort}`
        );
      }
    }

    if (host.dynamicForwards) {
      for (const df of host.dynamicForwards) {
        const bind = df.bindAddress ? `${formatAddress(df.bindAddress)}:` : '';
        lines.push(`    DynamicForward ${bind}${df.port}`);
      }
    }

    if (host.customDirectives) {
      for (const [key, val] of Object.entries(host.customDirectives)) {
        lines.push(`    ${key} ${val}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Serializes an array of SSHHost models into a full OpenSSH config file
   */
  public static serializeAll(hosts: SSHHost[], identityFileMap?: Map<string, string>): string {
    const header = [
      '# SSHBond OpenSSH Configuration',
      `# Exported: ${new Date().toISOString()}`,
      '',
    ];

    // Put Host * if present first or last
    const specificHosts = hosts.filter(h => h.alias !== '*');
    const globalHosts = hosts.filter(h => h.alias === '*');

    const blocks: string[] = [];

    for (const host of specificHosts) {
      blocks.push(this.serializeHost(host, identityFileMap));
    }

    for (const host of globalHosts) {
      blocks.push(this.serializeHost(host, identityFileMap));
    }

    return [...header, blocks.join('\n\n')].join('\n');
  }
}

/**
 * Brackets an IPv6 literal, which OpenSSH requires wherever an address is
 * followed by `:port` -- an unbracketed one cannot be read back.
 */
function formatAddress(address: string): string {
  return address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
}
