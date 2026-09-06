import { ResolvedSSHConfig } from '@/domain/models/sshConfig';

export function assertSupportedConfig(config: Pick<ResolvedSSHConfig, 'proxyCommand' | 'forwardAgent'>): void {
  const proxyCommand = config.proxyCommand?.trim();
  if (proxyCommand && proxyCommand.toLowerCase() !== 'none') {
    throw new Error('ProxyCommand is not supported. No direct connection was attempted.');
  }
  if (config.forwardAgent) {
    throw new Error('Agent forwarding is not supported. Disable ForwardAgent to connect.');
  }
}
