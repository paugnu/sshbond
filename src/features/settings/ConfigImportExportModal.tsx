import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { ModalOverlay, DismissKeyboardButton } from '../common/KeyboardAwareModal';
import { useTheme } from '../../theme/ThemeContext';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHConfigSerializer } from '../../services/ssh/config/SSHConfigSerializer';
import { SSHConfigParser } from '../../services/ssh/config/SSHConfigParser';
import { Download, Upload, Copy, X, Check } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

interface ConfigImportExportModalProps {
  visible: boolean;
  initialMode: 'import' | 'export';
  onClose: () => void;
  onImportComplete?: () => void;
}

export const ConfigImportExportModal: React.FC<ConfigImportExportModalProps> = ({
  visible,
  initialMode,
  onClose,
  onImportComplete,
}) => {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'import' | 'export'>(initialMode);
  const [configText, setConfigText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTab(initialMode);
    if (initialMode === 'export') {
      loadExportConfig();
    } else {
      setConfigText('');
    }
  }, [initialMode, visible]);

  const loadExportConfig = async () => {
    const hosts = await HostStorageService.getHosts();
    const identities = await HostStorageService.getIdentities();
    const idMap = new Map<string, string>();
    identities.forEach(i => idMap.set(i.id, `~/.ssh/${i.name}`));

    const serialized = SSHConfigSerializer.serializeAll(hosts, idMap);
    setConfigText(serialized);
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(configText);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImport = async () => {
    if (!configText.trim()) return;

    try {
      const result = SSHConfigParser.parse(configText);
      if (result.hosts.length === 0) {
        Alert.alert('Import Failed', 'No valid SSH Host declarations found in the provided text.');
        return;
      }

      // Re-importing the same config previously created a second copy of every
      // host, because the parser mints a fresh id on each run. Match on alias
      // instead and update in place.
      const existing = await HostStorageService.getHosts();
      const byAlias = new Map(existing.map(h => [h.alias, h]));

      let created = 0;
      let updated = 0;

      for (const parsedHost of result.hosts) {
        const current = byAlias.get(parsedHost.alias);
        if (current) {
          await HostStorageService.saveHost({
            ...parsedHost,
            id: current.id,
            groupId: current.groupId,
            tags: current.tags,
            favorite: current.favorite,
            identityId: current.identityId,
            createdAt: current.createdAt,
          });
          updated++;
        } else {
          await HostStorageService.saveHost(parsedHost);
          created++;
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Import Successful',
        [
          created > 0 ? `${created} host${created === 1 ? '' : 's'} added` : null,
          updated > 0 ? `${updated} host${updated === 1 ? '' : 's'} updated` : null,
        ]
          .filter(Boolean)
          .join(', ') + '.'
      );
      onImportComplete?.();
      onClose();
    } catch (err: any) {
      Alert.alert('Parser Error', err?.message || 'Failed to parse OpenSSH configuration.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalOverlay style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, tab === 'export' && { borderBottomColor: colors.primary }]}
                onPress={() => {
                  setTab('export');
                  loadExportConfig();
                }}
              >
                <Upload size={14} color={tab === 'export' ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabText, { color: tab === 'export' ? colors.text : colors.textMuted }]}>
                  Export Config
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, tab === 'import' && { borderBottomColor: colors.primary }]}
                onPress={() => {
                  setTab('import');
                  setConfigText('');
                }}
              >
                <Download size={14} color={tab === 'import' ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabText, { color: tab === 'import' ? colors.text : colors.textMuted }]}>
                  Import Config
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerActions}>
              <DismissKeyboardButton color={colors.primary} />
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <X size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {tab === 'export'
              ? 'Standard OpenSSH ~/.ssh/config format export. Private keys are never included.'
              : 'Paste standard OpenSSH config directives (e.g. Host, HostName, User, ProxyJump, etc.):'}
          </Text>

          <TextInput
            style={[
              styles.textArea,
              { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
            ]}
            value={configText}
            onChangeText={setConfigText}
            placeholder={
              tab === 'import'
                ? 'Host web-prod\n    HostName server.example.com\n    User ubuntu\n    Port 22\n    ProxyJump gateway'
                : ''
            }
            placeholderTextColor={colors.textSubtle}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            editable={tab === 'import'}
          />

          <View style={styles.footer}>
            {tab === 'export' ? (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={handleCopy}
              >
                {copied ? <Check size={16} color="#ffffff" /> : <Copy size={16} color="#ffffff" />}
                <Text style={styles.actionBtnText}>{copied ? 'Copied to Clipboard' : 'Copy Config'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={handleImport}
                disabled={!configText.trim()}
              >
                <Download size={16} color="#ffffff" />
                <Text style={styles.actionBtnText}>Parse & Import Hosts</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ModalOverlay>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    padding: 16,
  },
  card: {
    maxHeight: '90%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 16,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 8,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
  },
  textArea: {
    // Shrinks as the keyboard takes the screen, so the action button below is
    // never pushed out of reach.
    flexShrink: 1,
    minHeight: 120,
    height: 300,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  footer: {
    marginTop: 14,
  },
  actionButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
