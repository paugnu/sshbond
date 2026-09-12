import { FormInput as TextInput, FormScrollView as ScrollView } from '../common/FormControls';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { ModalOverlay } from '../common/KeyboardAwareModal';
import { useTheme } from '../../theme/ThemeContext';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHConfigSerializer } from '../../services/ssh/config/SSHConfigSerializer';
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
  const [importing, setImporting] = useState(false);

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
    if (!configText.trim() || importing) return;
    setImporting(true);

    try {
      const { created, updated } = await HostStorageService.importConfig(configText);

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
    } finally {
      setImporting(false);
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
                  Export
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
                  Import
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity accessibilityLabel="Close config dialog" accessibilityRole="button" onPress={onClose} style={styles.closeBtn}>
                <X size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flexShrink: 1 }}><Text style={[styles.subtitle, { color: colors.textMuted }]}>
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

          </ScrollView>
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
                disabled={importing || !configText.trim()}
              >
                <Download size={16} color="#ffffff" />
                <Text style={styles.actionBtnText}>{importing ? 'Importing…' : 'Parse & Import Hosts'}</Text>
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
    maxHeight: '100%',
    flexShrink: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  closeBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 220,
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
