import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHIdentity } from '@/domain/models/sshConfig';
import { KeyCard } from '../../features/keys/KeyCard';
import { GenerateKeyModal } from '../../features/keys/GenerateKeyModal';
import { ImportKeyModal } from '../../features/keys/ImportKeyModal';
import { Key, Plus, Download } from 'lucide-react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';

export default function KeysScreen() {
  const { colors } = useTheme();
  const [identities, setIdentities] = useState<SSHIdentity[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const loadIdentities = async () => {
    const loaded = await HostStorageService.getIdentities();
    setIdentities(loaded);
  };

  useFocusEffect(
    useCallback(() => {
      loadIdentities();
    }, [])
  );

  const handleDeleteIdentity = (id: string, name: string) => {
    Alert.alert('Delete SSH Key', `Are you sure you want to delete "${name}" from secure storage? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await HostStorageService.deleteIdentity(id);
          await loadIdentities();
        },
      },
    ]);
  };

  /**
   * Shares the *public* key as a `.pub` file, which is what the user needs to
   * append to a server's authorized_keys. The private half is never written
   * outside the keychain.
   */
  const handleShareKey = async (identity: SSHIdentity) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        await Clipboard.setStringAsync(identity.publicKey);
        Alert.alert('Public Key Copied', 'Sharing is unavailable here, so the key went to the clipboard.');
        return;
      }

      const fileUri = `${FileSystem.cacheDirectory}${sanitiseFileName(identity.name)}.pub`;
      await FileSystem.writeAsStringAsync(fileUri, `${identity.publicKey}\n`);

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: `Share ${identity.name}.pub`,
      });

      // The cache copy has served its purpose; leaving public keys lying around
      // in a shared cache directory is untidy even though they are not secret.
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch (err) {
      Alert.alert('Share Failed', err instanceof Error ? err.message : 'Could not share this key.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Action Bar */}
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.topBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowGenerateModal(true)}
        >
          <Plus size={14} color="#ffffff" />
          <Text style={styles.topBtnText}>Generate Key</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.topBtn, styles.topBtnOutline, { borderColor: colors.border }]}
          onPress={() => setShowImportModal(true)}
        >
          <Download size={14} color={colors.text} />
          <Text style={[styles.topBtnText, { color: colors.text }]}>Import Key</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {identities.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSubtle }]}>
              <Key size={32} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No SSH Keys</Text>
            <Text style={[styles.emptyDesc, { color: colors.textMuted }]}>
              Generate a modern Ed25519 key or import existing SSH keys. Private keys are stored in the device&apos;s protected Keychain / Keystore. SSHBond reads them locally to authenticate your connections.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>IDENTITIES ({identities.length})</Text>
            {identities.map(identity => (
              <KeyCard
                key={identity.id}
                identity={identity}
                onDelete={() => handleDeleteIdentity(identity.id, identity.name)}
                onShare={() => handleShareKey(identity)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <GenerateKeyModal
        visible={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onGenerated={loadIdentities}
      />

      <ImportKeyModal
        visible={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={loadIdentities}
      />
    </View>
  );
}

function sanitiseFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'ssh_key';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
  },
  topBtn: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  topBtnOutline: {
    borderWidth: 1,
  },
  topBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
