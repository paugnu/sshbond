import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';
import { HostStorageService, AppSettings } from '../../services/persistence/HostStorageService';
import { KnownHost } from '@/domain/models/sshConfig';
import { SecureStorageService } from '../../services/secureStorage/SecureStorageService';
import { ConfigImportExportModal } from '../../features/settings/ConfigImportExportModal';
import {
  Sun,
  Moon,
  Monitor,
  Copy,
  ChevronRight,
  Minus,
  Plus,
  Trash2,
  ServerCrash,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, themePreference, setThemePreference, terminalThemeName, setTerminalThemeName } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configModalMode, setConfigModalMode] = useState<'import' | 'export'>('export');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([]);
  const [showKnownHosts, setShowKnownHosts] = useState(false);

  useEffect(() => {
    HostStorageService.getSettings().then(setSettings);
    HostStorageService.getKnownHosts().then(setKnownHosts);
    SecureStorageService.isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const handleForgetHostKey = (knownHost: KnownHost) => {
    Alert.alert(
      'Forget Host Key',
      `SSHBond will treat ${knownHost.hostname}:${knownHost.port} as a new host and ask you to verify its key again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            await HostStorageService.removeKnownHost(knownHost.id);
            setKnownHosts(await HostStorageService.getKnownHosts());
          },
        },
      ]
    );
  };

  const handleClearHistory = () => {
    Alert.alert('Clear Connection History', 'Remove all recorded connection attempts?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => HostStorageService.clearHistory(),
      },
    ]);
  };

  const handleUpdate = async (updates: Partial<AppSettings>) => {
    const updated = await HostStorageService.updateSettings(updates);
    setSettings(updated);
  };

  const handleCopyDiagnostics = async () => {
    const hosts = await HostStorageService.getHosts();
    const identities = await HostStorageService.getIdentities();
    const knownHosts = await HostStorageService.getKnownHosts();

    const report = [
      '=== SSHBond Diagnostic Summary ===',
      `App Version: 1.0.0`,
      `Platform: React Native / Expo Native Core`,
      `Saved Hosts Count: ${hosts.length}`,
      `Configured Identities Count: ${identities.length}`,
      `Trusted Known Hosts Count: ${knownHosts.length}`,
      `Biometric Lock: ${settings?.requireBiometrics ? 'Enabled' : 'Disabled'}`,
      `Terminal Theme: ${terminalThemeName}`,
      `Confirm Multiline Paste: ${settings?.confirmMultilinePaste ? 'Yes' : 'No'}`,
      `Keep Awake: ${settings?.keepAwakeDuringSession ? 'Yes' : 'No'}`,
    ].join('\n');

    await Clipboard.setStringAsync(report);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Diagnostic Info Copied', 'Sanitized system diagnostic report copied to clipboard.');
  };

  if (!settings) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Appearance Section */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>APPEARANCE</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.themeSelector}>
            {(['system', 'dark', 'light'] as const).map(pref => {
              const selected = themePreference === pref;
              return (
                <TouchableOpacity
                  key={pref}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setThemePreference(pref)}
                >
                  {pref === 'system' ? (
                    <Monitor size={16} color={selected ? '#ffffff' : colors.text} />
                  ) : pref === 'dark' ? (
                    <Moon size={16} color={selected ? '#ffffff' : colors.text} />
                  ) : (
                    <Sun size={16} color={selected ? '#ffffff' : colors.text} />
                  )}
                  <Text style={[styles.themeOptionText, { color: selected ? '#ffffff' : colors.text }]}>
                    {pref.charAt(0).toUpperCase() + pref.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Terminal Themes */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>TERMINAL THEME</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.termThemesGrid}>
            {(
              ['nord', 'dracula', 'solarized-dark', 'solarized-light', 'system-dark', 'system-light'] as const
            ).map(tName => {
              const selected = terminalThemeName === tName;
              return (
                <TouchableOpacity
                  key={tName}
                  style={[
                    styles.termThemeChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setTerminalThemeName(tName)}
                >
                  <Text style={[styles.termThemeText, { color: selected ? '#ffffff' : colors.text }]}>
                    {tName.replace('-', ' ').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Security Section */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>SECURITY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Require Biometrics</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Authenticate when opening or returning to SSHBond
              </Text>
            </View>
            <Switch
              value={settings.requireBiometrics}
              onValueChange={async (val) => {
                if (val && !biometricAvailable) {
                  Alert.alert('Biometrics unavailable', 'Set up Face ID or fingerprints in your device settings first.');
                  return;
                }
                if (val) {
                  const verified = await SecureStorageService.promptBiometrics('Confirm Biometrics');
                  if (verified) handleUpdate({ requireBiometrics: true });
                } else {
                  handleUpdate({ requireBiometrics: false });
                }
              }}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Confirm Multiline Paste</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Display warning modal before pasting multiple lines into terminal
              </Text>
            </View>
            <Switch
              value={settings.confirmMultilinePaste}
              onValueChange={(val) => handleUpdate({ confirmMultilinePaste: val })}
            />
          </View>
        </View>

        {/* Terminal Rendering */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>TERMINAL RENDERING</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Font Size</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Applies to new terminal sessions
              </Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, { borderColor: colors.border }]}
                onPress={() => handleUpdate({ terminalFontSize: Math.max(8, settings.terminalFontSize - 1) })}
              >
                <Minus size={14} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, { color: colors.text }]}>{settings.terminalFontSize}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, { borderColor: colors.border }]}
                onPress={() => handleUpdate({ terminalFontSize: Math.min(28, settings.terminalFontSize + 1) })}
              >
                <Plus size={14} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <Text style={[styles.settingLabel, { color: colors.text, marginBottom: 8 }]}>Cursor Style</Text>
          <View style={styles.themeSelector}>
            {(['block', 'underline', 'bar'] as const).map(style => {
              const selected = settings.cursorStyle === style;
              return (
                <TouchableOpacity
                  key={style}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleUpdate({ cursorStyle: style })}
                >
                  <Text style={[styles.themeOptionText, { color: selected ? '#ffffff' : colors.text }]}>
                    {style.charAt(0).toUpperCase() + style.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Keep Screen Awake</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Prevent the device locking while a session is open
              </Text>
            </View>
            <Switch
              value={settings.keepAwakeDuringSession}
              onValueChange={val => handleUpdate({ keepAwakeDuringSession: val })}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Haptic Feedback</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Vibrate on toolbar keys and confirmations
              </Text>
            </View>
            <Switch
              value={settings.hapticFeedback}
              onValueChange={val => handleUpdate({ hapticFeedback: val })}
            />
          </View>
        </View>

        {/* Trusted Host Keys */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>TRUSTED HOST KEYS</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.clickableRow} onPress={() => setShowKnownHosts(v => !v)}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Known Hosts</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                {knownHosts.length === 0
                  ? 'No host keys trusted yet'
                  : `${knownHosts.length} server key${knownHosts.length === 1 ? '' : 's'} trusted on this device`}
              </Text>
            </View>
            <ChevronRight
              size={18}
              color={colors.textMuted}
              style={{ transform: [{ rotate: showKnownHosts ? '90deg' : '0deg' }] }}
            />
          </TouchableOpacity>

          {showKnownHosts &&
            knownHosts.map(knownHost => (
              <View key={knownHost.id} style={[styles.knownHostRow, { borderTopColor: colors.borderSubtle }]}>
                <View style={styles.settingLabelContainer}>
                  <Text style={[styles.knownHostName, { color: colors.text }]} numberOfLines={1}>
                    {knownHost.hostname}:{knownHost.port}
                  </Text>
                  <Text style={[styles.knownHostFp, { color: colors.textMuted }]} numberOfLines={1}>
                    {knownHost.algorithm} • {knownHost.fingerprint}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleForgetHostKey(knownHost)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ServerCrash size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
        </View>

        {/* Configuration Import / Export */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>OPENSSH CONFIGURATION</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.clickableRow}
            onPress={() => {
              setConfigModalMode('export');
              setShowConfigModal(true);
            }}
          >
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Export SSH Config</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Export hosts in standard ~/.ssh/config format
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <TouchableOpacity
            style={styles.clickableRow}
            onPress={() => {
              setConfigModalMode('import');
              setShowConfigModal(true);
            }}
          >
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Import SSH Config</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Paste existing OpenSSH config to auto-create hosts
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Diagnostics & Info */}
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>DIAGNOSTICS & ABOUT</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.clickableRow} onPress={handleCopyDiagnostics}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Copy Diagnostic Information</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                App settings and counts (no secrets)
              </Text>
            </View>
            <Copy size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <TouchableOpacity style={styles.clickableRow} onPress={handleClearHistory}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Clear Connection History</Text>
              <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                Delete the local record of recent connection attempts
              </Text>
            </View>
            <Trash2 size={16} color={colors.error} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <TouchableOpacity style={styles.clickableRow} onPress={() => router.push('/privacy')}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Privacy Policy</Text>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.clickableRow} onPress={() => {
            void Linking.openURL('mailto:info@yogabond.es?subject=SSHBond%20support').catch(() => {
              Alert.alert('SSHBond Support', 'Email info@yogabond.es for help. Never send passwords or private keys.');
            });
          }}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Support · info@yogabond.es</Text>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutTitle, { color: colors.text }]}>SSHBond — OpenSSH Client</Text>
            <Text style={[styles.aboutSub, { color: colors.textMuted }]}>Version 1.0.0 • Local-First Architecture</Text>
          </View>
        </View>
      </ScrollView>

      <ConfigImportExportModal
        visible={showConfigModal}
        initialMode={configModalMode}
        onClose={() => setShowConfigModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  themeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  themeOptionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  termThemesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  termThemeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  termThemeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  settingSub: {
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
  clickableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  knownHostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: 1,
  },
  knownHostName: {
    fontSize: 13,
    fontWeight: '600',
  },
  knownHostFp: {
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  aboutRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  aboutSub: {
    fontSize: 11,
    marginTop: 2,
  },
});
