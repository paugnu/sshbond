import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DismissKeyboardButton } from '../common/KeyboardAwareModal';
import { FormInput as TextInput, FormScrollView as ScrollView } from '../common/FormControls';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { SSHHost, SSHIdentity, SSHGroup, SSHAuthType } from '@/domain/models/sshConfig';
import { useTheme } from '../../theme/ThemeContext';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHConfigSerializer } from '../../services/ssh/config/SSHConfigSerializer';
import { SSHConfigParser } from '../../services/ssh/config/SSHConfigParser';
import {
  Server,
  Key,
  Shield,
  Clock,
  Share2,
  ChevronDown,
  ChevronRight,
  Code,
  FileText,
  Save,
  Trash2,
  Plus,
  GitBranch,
} from 'lucide-react-native';

/** Explains each policy in the terms that matter when connecting. */
const STRICT_HOST_KEY_HINTS: Record<string, string> = {
  ask: 'Prompt before trusting a new or changed host key (recommended).',
  'accept-new': 'Trust new hosts automatically, but always refuse a changed key.',
  yes: 'Only connect to hosts whose key is already trusted.',
  no: 'Trust new hosts automatically. A changed key is still refused.',
};

interface HostEditorProps {
  initialHost?: SSHHost;
  onSave: (host: SSHHost) => Promise<void>;
  onImportComplete?: () => void;
  onDelete?: (id: string) => Promise<void>;
  onCancel: () => void;
}

export const HostEditor: React.FC<HostEditorProps> = ({
  initialHost,
  onSave,
  onImportComplete,
  onDelete,
  onCancel,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [saving, setSaving] = useState(false);

  // Mode: Form vs Raw Config
  const [mode, setMode] = useState<'form' | 'raw'>('form');
  const [rawConfigText, setRawConfigText] = useState('');

  // Identifiers and groups
  const [identities, setIdentities] = useState<SSHIdentity[]>([]);
  const [groups, setGroups] = useState<SSHGroup[]>([]);

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    connection: false,
    jumpHost: false,
    portForward: false,
    terminal: false,
    security: false,
    custom: false,
  });

  // Host form state
  const [alias, setAlias] = useState(initialHost?.alias || '');
  const [hostname, setHostname] = useState(initialHost?.hostname || '');
  const [port, setPort] = useState(initialHost?.port ? String(initialHost.port) : '22');
  const [username, setUsername] = useState(initialHost?.username || '');
  const [groupId, setGroupId] = useState(initialHost?.groupId || '');
  const [authType, setAuthType] = useState<SSHAuthType>(initialHost?.authenticationType || 'key');
  const [identityId, setIdentityId] = useState(initialHost?.identityId || '');
  const [proxyJump, setProxyJump] = useState(initialHost?.proxyJump || '');
  const [serverAliveInterval, setServerAliveInterval] = useState(
    initialHost?.serverAliveInterval !== undefined ? String(initialHost.serverAliveInterval) : ''
  );
  const [connectTimeout, setConnectTimeout] = useState(
    initialHost?.connectTimeout !== undefined ? String(initialHost.connectTimeout) : '30'
  );
  const [compression, setCompression] = useState(initialHost?.compression || false);
  const [forwardAgent, setForwardAgent] = useState(initialHost?.forwardAgent || false);
  const [remoteCommand, setRemoteCommand] = useState(initialHost?.remoteCommand || '');
  const [localForwardBind, setLocalForwardBind] = useState('');
  const [localForwardTarget, setLocalForwardTarget] = useState('');
  const [localForwards, setLocalForwards] = useState(initialHost?.localForwards || []);
  const [remoteForwardBind, setRemoteForwardBind] = useState('');
  const [remoteForwardTarget, setRemoteForwardTarget] = useState('');
  const [remoteForwards, setRemoteForwards] = useState(initialHost?.remoteForwards || []);
  const [dynamicForwardPort, setDynamicForwardPort] = useState('');
  const [dynamicForwards, setDynamicForwards] = useState(initialHost?.dynamicForwards || []);
  const [strictHostKeyChecking, setStrictHostKeyChecking] = useState(
    initialHost?.strictHostKeyChecking || 'ask'
  );
  const [customDirectives, setCustomDirectives] = useState<Record<string, string>>(
    initialHost?.customDirectives || {}
  );

  useEffect(() => {
    HostStorageService.getIdentities().then(ids => {
      setIdentities(ids);
      // Preselect a key only when the host does not already name one.
      setIdentityId(current => current || ids[0]?.id || '');
    });
    HostStorageService.getGroups().then(setGroups);
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Build current host model from form fields
  const buildCurrentHost = (): SSHHost => {
    const p = parseInt(port, 10);
    const interval = serverAliveInterval ? parseInt(serverAliveInterval, 10) : undefined;
    const timeout = connectTimeout ? parseInt(connectTimeout, 10) : 30;

    return {
      id: initialHost?.id || `host_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      alias: alias.trim() || hostname.trim() || 'unnamed-host',
      hostname: hostname.trim() || alias.trim(),
      port: !isNaN(p) && p > 0 ? p : 22,
      username: username.trim(),
      groupId: groupId || undefined,
      tags: initialHost?.tags || [],
      favorite: initialHost?.favorite || false,
      authenticationType: authType,
      identityId: authType === 'key' ? identityId : undefined,
      identityFile: initialHost?.identityFile,
      proxyJump: proxyJump.trim() || undefined,
      serverAliveInterval: interval,
      connectTimeout: timeout,
      compression,
      forwardAgent,
      remoteCommand: remoteCommand.trim() || undefined,
      localForwards: localForwards.length > 0 ? localForwards : undefined,
      remoteForwards: remoteForwards.length > 0 ? remoteForwards : undefined,
      dynamicForwards: dynamicForwards.length > 0 ? dynamicForwards : undefined,
      strictHostKeyChecking: strictHostKeyChecking as any,
      customDirectives: Object.keys(customDirectives).length > 0 ? customDirectives : undefined,
      createdAt: initialHost?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  // Switch to Raw Config Mode
  const handleSwitchToRaw = () => {
    const host = buildCurrentHost();
    const serialized = SSHConfigSerializer.serializeHost(host);
    setRawConfigText(serialized);
    setMode('raw');
  };

  // Switch to Form Mode
  const handleSwitchToForm = () => {
    try {
      const parsed = SSHConfigParser.parse(rawConfigText);
      if (parsed.hosts.length !== 1) {
        Alert.alert('Keep all hosts', 'Stay in Config mode to import multiple hosts. The form edits one host at a time.');
        return;
      }
      if (parsed.hosts.length > 0) {
        const h = parsed.hosts[0];
        setAlias(h.alias);
        setHostname(h.hostname);
        setPort(String(h.port));
        setUsername(h.username);
        setAuthType(h.authenticationType);
        if (h.proxyJump) setProxyJump(h.proxyJump);
        if (h.serverAliveInterval) setServerAliveInterval(String(h.serverAliveInterval));
        if (h.connectTimeout) setConnectTimeout(String(h.connectTimeout));
        if (h.compression !== undefined) setCompression(h.compression);
        if (h.forwardAgent !== undefined) setForwardAgent(h.forwardAgent);
        if (h.remoteCommand) setRemoteCommand(h.remoteCommand);
        if (h.localForwards) setLocalForwards(h.localForwards);
        if (h.remoteForwards) setRemoteForwards(h.remoteForwards);
        if (h.dynamicForwards) setDynamicForwards(h.dynamicForwards);
        if (h.customDirectives) setCustomDirectives(h.customDirectives);
      }
    } catch {
      // Keep existing state if parse fails
    }
    setMode('form');
  };

  const handleSave = async () => {
    if (saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      if (mode === 'raw') {
        const parsed = SSHConfigParser.parse(rawConfigText);
        if (!parsed.hosts.length) throw new Error('No valid SSH Host declarations found.');
        if (!initialHost) {
          const result = await HostStorageService.importConfig(rawConfigText);
          Alert.alert('Import Successful', `${result.created} hosts added, ${result.updated} updated.`);
          onImportComplete?.();
        } else {
          if (parsed.hosts.length !== 1) throw new Error('This screen edits one host. Use Add Host or Settings to import a configuration with multiple hosts.');
          await onSave({ ...parsed.hosts[0], id: initialHost.id, groupId: initialHost.groupId,
            tags: initialHost.tags, favorite: initialHost.favorite, identityId: parsed.hosts[0].authenticationType === 'key' ? identityId : undefined,
            createdAt: initialHost.createdAt });
        }
        return;
      }
      if (!alias.trim() && !hostname.trim()) throw new Error('Please provide a Host Alias or Hostname.');
      await onSave(buildCurrentHost());
    } catch (error) {
      Alert.alert('Unable to save', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Rules go through the same parser that reads `~/.ssh/config`, so what this
   * form accepts and what an imported config means cannot drift apart. A rule
   * that will not parse is refused here rather than saved in a shape the engine
   * would later ignore.
   */
  const handleAddPortForward = (kind: 'local' | 'remote') => {
    const bind = (kind === 'local' ? localForwardBind : remoteForwardBind).trim();
    const target = (kind === 'local' ? localForwardTarget : remoteForwardTarget).trim();

    const [rule] = SSHConfigParser.parsePortForwards(`${bind} ${target}`);
    if (!rule) {
      Alert.alert(
        'Invalid Forward',
        'Enter a port such as 8080 (or 127.0.0.1:8080) and a target such as db.internal:5432.'
      );
      return;
    }

    if (kind === 'local') {
      setLocalForwards(prev => [...prev, rule]);
      setLocalForwardBind('');
      setLocalForwardTarget('');
    } else {
      setRemoteForwards(prev => [...prev, rule]);
      setRemoteForwardBind('');
      setRemoteForwardTarget('');
    }
  };

  const handleAddDynamicForward = () => {
    const [rule] = SSHConfigParser.parseDynamicForwards(dynamicForwardPort.trim());
    if (!rule) {
      Alert.alert('Invalid Forward', 'Enter a port such as 1080, or 127.0.0.1:1080 to choose the interface.');
      return;
    }

    setDynamicForwards(prev => [...prev, rule]);
    setDynamicForwardPort('');
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
      {/* Top Switcher */}
      <View style={[styles.modeBar, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'form' && { backgroundColor: colors.surface }]}
          onPress={() => mode === 'raw' && handleSwitchToForm()}
        >
          <FileText size={14} color={mode === 'form' ? colors.primary : colors.textMuted} />
          <Text style={[styles.modeBtnText, { color: mode === 'form' ? colors.text : colors.textMuted }]}>
            Form Editor
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeBtn, mode === 'raw' && { backgroundColor: colors.surface }]}
          onPress={() => mode === 'form' && handleSwitchToRaw()}
        >
          <Code size={14} color={mode === 'raw' ? colors.primary : colors.textMuted} />
          <Text style={[styles.modeBtnText, { color: mode === 'raw' ? colors.text : colors.textMuted }]}>
            Raw OpenSSH Config
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {mode === 'raw' ? (
          <View style={styles.rawSection}>
            <Text style={[styles.rawHint, { color: colors.textMuted }]}>
              Edit OpenSSH config. Keys selected in Form Editor stay in secure storage.
            </Text>
            {authType === 'key' && identityId && (
              <Text style={[styles.rawHint, { color: colors.text }]}>
                SSH key: {identities.find(key => key.id === identityId)?.name || 'Selected key'} (stored on this device)
              </Text>
            )}
            <TextInput
              style={[
                styles.rawInput,
                { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border },
              ]}
              value={rawConfigText}
              onChangeText={setRawConfigText}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : (
          <View style={styles.formSection}>
            {/* Basic Section */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Server size={16} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>Basic Connection</Text>
              </View>

              <Text style={[styles.label, { color: colors.textMuted }]}>Host Alias / Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                value={alias}
                onChangeText={setAlias}
                placeholder="e.g. web-prod or db-server"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.row}>
                <View style={{ flex: 3 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Hostname or IP</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    value={hostname}
                    onChangeText={setHostname}
                    placeholder="server.example.com or 10.0.0.1"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Port</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    value={port}
                    onChangeText={setPort}
                    placeholder="22"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={[styles.label, { color: colors.textMuted }]}>Username</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                value={username}
                onChangeText={setUsername}
                placeholder="ubuntu, root, pau..."
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* Group Selector */}
              {groups.length > 0 && (
                <View>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Group</Text>
                  <View style={styles.groupChips}>
                    <TouchableOpacity
                      style={[
                        styles.chip,
                        {
                          backgroundColor: !groupId ? colors.primary : colors.surfaceSubtle,
                          borderColor: !groupId ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setGroupId('')}
                    >
                      <Text style={[styles.chipText, { color: !groupId ? '#ffffff' : colors.text }]}>None</Text>
                    </TouchableOpacity>
                    {groups.map(g => {
                      const selected = groupId === g.id;
                      return (
                        <TouchableOpacity
                          key={g.id}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                              borderColor: selected ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => setGroupId(g.id)}
                        >
                          <Text style={[styles.chipText, { color: selected ? '#ffffff' : colors.text }]}>
                            {g.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* Authentication Section */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Key size={16} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>Authentication</Text>
              </View>

              <View style={styles.authTypeRow}>
                {(['key', 'password'] as SSHAuthType[]).map((t) => {
                  const selected = authType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.authTypeBtn,
                        {
                          backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setAuthType(t)}
                    >
                      <Text style={[styles.authTypeText, { color: selected ? '#ffffff' : colors.text }]}>
                        {t === 'key' ? 'SSH Key' : 'Password'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {authType === 'key' && (
                <View style={{ marginTop: 10 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Identity Key</Text>
                  {identities.length === 0 ? (
                    <Text style={[styles.noKeysText, { color: colors.textSubtle }]}>
                      No SSH keys created yet. Generate or import one from the Keys tab.
                    </Text>
                  ) : (
                    <View style={styles.identityList}>
                      {identities.map(id => {
                        const selected = identityId === id.id;
                        return (
                          <TouchableOpacity
                            key={id.id}
                            style={[
                              styles.identityItem,
                              {
                                backgroundColor: selected ? colors.surfaceActive : colors.background,
                                borderColor: selected ? colors.primary : colors.border,
                              },
                            ]}
                            onPress={() => setIdentityId(id.id)}
                          >
                            <View>
                              <Text style={[styles.identityName, { color: colors.text }]}>{id.name}</Text>
                              <Text style={[styles.identityFp, { color: colors.textMuted }]}>{id.algorithm.toUpperCase()} • {id.fingerprint.slice(0, 24)}...</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Jump Host Section */}
            <View style={[styles.accordionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('jumpHost')}>
                <View style={styles.accordionTitleRow}>
                  <GitBranch size={16} color={colors.text} />
                  <Text style={[styles.accordionTitle, { color: colors.text }]}>Jump Host / ProxyJump{Platform.OS === 'ios' ? ' (Android only)' : ''}</Text>
                </View>
                {expandedSections.jumpHost ? <ChevronDown size={18} color={colors.textMuted} /> : <ChevronRight size={18} color={colors.textMuted} />}
              </TouchableOpacity>

              {expandedSections.jumpHost && (
                <View style={styles.accordionBody}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>ProxyJump (Bastion Host / Chain)</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    value={proxyJump}
                    onChangeText={setProxyJump}
                    placeholder="jump@gateway:2222 or bastion1,bastion2"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={[styles.hint, { color: colors.textSubtle, marginTop: 8 }]}>
                    {Platform.OS === 'ios' ? 'ProxyJump is not available on iOS. Hosts that require a jump host cannot connect here. ' : ''}
                    A hop naming a saved host uses that host&apos;s user, port and key; anything
                    else needs a user, as in jump@gateway. Each machine in the chain is asked
                    about and trusted separately, and none is authenticated before its host key
                    is. Use none to cancel a ProxyJump inherited from a wildcard host.
                  </Text>
                </View>
              )}
            </View>

            {/* Keep Alive & Timeouts Section */}
            <View style={[styles.accordionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('connection')}>
                <View style={styles.accordionTitleRow}>
                  <Clock size={16} color={colors.text} />
                  <Text style={[styles.accordionTitle, { color: colors.text }]}>Keep Alive & Timeouts</Text>
                </View>
                {expandedSections.connection ? <ChevronDown size={18} color={colors.textMuted} /> : <ChevronRight size={18} color={colors.textMuted} />}
              </TouchableOpacity>

              {expandedSections.connection && (
                <View style={styles.accordionBody}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, { color: colors.textMuted }]}>ServerAliveInterval (sec)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                        value={serverAliveInterval}
                        onChangeText={setServerAliveInterval}
                        placeholder="60"
                        placeholderTextColor={colors.textSubtle}
                        keyboardType="number-pad"
                      />
                    </View>

                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={[styles.label, { color: colors.textMuted }]}>ConnectTimeout (sec)</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                        value={connectTimeout}
                        onChangeText={setConnectTimeout}
                        placeholder="30"
                        placeholderTextColor={colors.textSubtle}
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Port Forwarding Section */}
            <View style={[styles.accordionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('portForward')}>
                <View style={styles.accordionTitleRow}>
                  <Share2 size={16} color={colors.text} />
                  <Text style={[styles.accordionTitle, { color: colors.text }]}>Port Forwarding (-L / -R / -D){Platform.OS === 'ios' ? ' (Android only)' : ''}</Text>
                </View>
                {expandedSections.portForward ? <ChevronDown size={18} color={colors.textMuted} /> : <ChevronRight size={18} color={colors.textMuted} />}
              </TouchableOpacity>

              {expandedSections.portForward && (
                <View style={styles.accordionBody}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Add Local Forward (-L)</Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={localForwardBind}
                      onChangeText={setLocalForwardBind}
                      placeholder="Local Port (8080)"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={[styles.input, { flex: 2, marginLeft: 6, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={localForwardTarget}
                      onChangeText={setLocalForwardTarget}
                      placeholder="Target (127.0.0.1:80)"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.addBtn, { backgroundColor: colors.primary, marginLeft: 6 }]}
                      onPress={() => handleAddPortForward('local')}
                    >
                      <Plus size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  {localForwards.map((lf, i) => (
                    <View key={`local_${i}`} style={[styles.forwardTag, { backgroundColor: colors.surfaceSubtle }]}>
                      <Text style={[styles.forwardText, { color: colors.text }]}>
                        -L {lf.bindAddress ? `${lf.bindAddress}:` : ''}{lf.bindPort} → {lf.targetHost}:{lf.targetPort}
                      </Text>
                      <TouchableOpacity onPress={() => setLocalForwards(prev => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 size={14} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <Text style={[styles.label, { color: colors.textMuted, marginTop: 12 }]}>
                    Add Remote Forward (-R)
                  </Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={remoteForwardBind}
                      onChangeText={setRemoteForwardBind}
                      placeholder="Remote Port (9000)"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={[styles.input, { flex: 2, marginLeft: 6, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={remoteForwardTarget}
                      onChangeText={setRemoteForwardTarget}
                      placeholder="Target (127.0.0.1:3000)"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.addBtn, { backgroundColor: colors.primary, marginLeft: 6 }]}
                      onPress={() => handleAddPortForward('remote')}
                    >
                      <Plus size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  {remoteForwards.map((rf, i) => (
                    <View key={`remote_${i}`} style={[styles.forwardTag, { backgroundColor: colors.surfaceSubtle }]}>
                      <Text style={[styles.forwardText, { color: colors.text }]}>
                        -R {rf.bindAddress ? `${rf.bindAddress}:` : ''}{rf.bindPort} → {rf.targetHost}:{rf.targetPort}
                      </Text>
                      <TouchableOpacity onPress={() => setRemoteForwards(prev => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 size={14} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <Text style={[styles.label, { color: colors.textMuted, marginTop: 12 }]}>
                    Add Dynamic Forward (-D)
                  </Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, { flex: 3, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={dynamicForwardPort}
                      onChangeText={setDynamicForwardPort}
                      placeholder="SOCKS Port (1080)"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.addBtn, { backgroundColor: colors.primary, marginLeft: 6 }]}
                      onPress={handleAddDynamicForward}
                    >
                      <Plus size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  {dynamicForwards.map((df, i) => (
                    <View key={`dynamic_${i}`} style={[styles.forwardTag, { backgroundColor: colors.surfaceSubtle }]}>
                      <Text style={[styles.forwardText, { color: colors.text }]}>
                        -D SOCKS5 on {df.bindAddress ? `${df.bindAddress}:` : ''}{df.port}
                      </Text>
                      <TouchableOpacity onPress={() => setDynamicForwards(prev => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 size={14} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <Text style={[styles.hint, { color: colors.textSubtle, marginTop: 10 }]}>
                    {Platform.OS === 'ios' ? 'Port forwarding is not available on iOS. These settings are retained for configuration export. ' : ''}
                    A forward that cannot be established is reported on the session rather than
                    taking it down, as with ssh itself. Bind to 127.0.0.1 unless you mean to expose
                    the port to your whole network.
                  </Text>
                </View>
              )}
            </View>

            {/* Security & Advanced */}
            <View style={[styles.accordionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('security')}>
                <View style={styles.accordionTitleRow}>
                  <Shield size={16} color={colors.text} />
                  <Text style={[styles.accordionTitle, { color: colors.text }]}>Security & Options</Text>
                </View>
                {expandedSections.security ? <ChevronDown size={18} color={colors.textMuted} /> : <ChevronRight size={18} color={colors.textMuted} />}
              </TouchableOpacity>

              {expandedSections.security && (
                <View style={styles.accordionBody}>
                  <View style={styles.switchRow}>
                    <Text style={[styles.switchLabel, { color: colors.text }]}>Compression (gzip)</Text>
                    <Switch value={compression} onValueChange={setCompression} />
                  </View>

                  <View style={styles.switchRow}>
                    <Text style={[styles.switchLabel, { color: colors.text }]}>ForwardAgent (not supported)</Text>
                    <Switch value={forwardAgent} disabled={!forwardAgent} onValueChange={setForwardAgent} />
                  </View>

                  <Text style={[styles.label, { color: colors.textMuted, marginTop: 8 }]}>
                    StrictHostKeyChecking
                  </Text>
                  <View style={styles.groupChips}>
                    {(['ask', 'accept-new', 'yes', 'no'] as const).map(policy => {
                      const selected = strictHostKeyChecking === policy;
                      return (
                        <TouchableOpacity
                          key={policy}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                              borderColor: selected ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => setStrictHostKeyChecking(policy)}
                        >
                          <Text style={[styles.chipText, { color: selected ? '#ffffff' : colors.text }]}>
                            {policy}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.hint, { color: colors.textSubtle }]}>
                    {STRICT_HOST_KEY_HINTS[strictHostKeyChecking]}
                  </Text>

                  <Text style={[styles.label, { color: colors.textMuted, marginTop: 8 }]}>Remote Command</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    value={remoteCommand}
                    onChangeText={setRemoteCommand}
                    placeholder="e.g. tmux attach || tmux new"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <DismissKeyboardButton color={colors.primary} />
      {/* Footer Action Buttons */}
      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {initialHost && onDelete && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn, { borderColor: colors.error }]}
            accessibilityLabel="Delete host"
            onPress={() => Alert.alert('Delete Host', `Remove "${initialHost.alias}"?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => {
                onDelete(initialHost.id).catch(() => Alert.alert('Unable to delete', 'Please try again.'));
              } },
            ])}
          >
            <Trash2 size={16} color={colors.error} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, styles.cancelBtn, { borderColor: colors.border }]}
          onPress={onCancel}
        >
          <Text style={[styles.actionBtnText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.saveBtn, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Save size={16} color="#ffffff" />
          <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>{saving ? 'Saving…' : mode === 'raw' && !initialHost ? 'Import Hosts' : 'Save Host'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  modeBar: {
    flexDirection: 'row',
    margin: 14,
    borderRadius: 8,
    borderWidth: 1,
    padding: 3,
  },
  modeBtn: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
  },
  modeBtnText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  rawSection: {
    flex: 1,
  },
  rawHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  rawInput: {
    height: 200,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  formSection: {
    gap: 12,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  authTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  authTypeBtn: {
    minHeight: 48,
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  authTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  noKeysText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  identityList: {
    gap: 6,
  },
  identityItem: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  identityName: {
    fontSize: 13,
    fontWeight: '600',
  },
  identityFp: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  accordionCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accordionHeader: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accordionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forwardTag: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  forwardText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  footer: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  actionBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  deleteBtn: {
    borderWidth: 1,
    marginRight: 'auto',
  },
  cancelBtn: {
    borderWidth: 1,
  },
  saveBtn: {},
  actionBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
  },
});
