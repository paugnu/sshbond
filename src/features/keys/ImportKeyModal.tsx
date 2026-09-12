import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { FormInput as TextInput, FormScrollView as ScrollView } from '../common/FormControls';
import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  Keyboard,
} from 'react-native';
import { ModalOverlay } from '../common/KeyboardAwareModal';
import { useTheme } from '../../theme/ThemeContext';
import { SSHKeyManager } from '@/services/ssh/keys/SSHKeyManager';
import { HostStorageService } from '@/services/persistence/HostStorageService';
import { SecureStorageService } from '@/services/secureStorage/SecureStorageService';
import { SSHIdentity } from '@/domain/models/sshConfig';
import { Download, X, Lock } from 'lucide-react-native';

interface ImportKeyModalProps {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

export const ImportKeyModal: React.FC<ImportKeyModalProps> = ({ visible, onClose, onImported }) => {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [publicKeyStr, setPublicKeyStr] = useState('');
  const [requireBiometrics, setRequireBiometrics] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('');
    setPrivateKeyPem('');
    setPublicKeyStr('');
    setRequireBiometrics(false);
  };

  const loadKeyFile = async (kind: 'private' | 'public') => {
    Keyboard.dismiss();
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      try {
        if (file.size && file.size > 128 * 1024) throw new Error('Select an SSH key file smaller than 128 KB.');
        const text = await FileSystem.readAsStringAsync(file.uri);
        if (text.length > 128 * 1024) throw new Error('This file is too large to be an SSH key.');
        if (kind === 'private') setPrivateKeyPem(text); else setPublicKeyStr(text);
        if (!name.trim()) setName(file.name.replace(/\.pub$/, ''));
      } finally {
        // The picker creates a temporary copy; do not leave private material in cache.
        if (FileSystem.cacheDirectory && file.uri.startsWith(FileSystem.cacheDirectory)) {
          await FileSystem.deleteAsync(file.uri, { idempotent: true });
        }
      }
    } catch (error) {
      Alert.alert('Unable to read key', error instanceof Error ? error.message : 'Choose a text key file.');
    }
  };

  const handleImport = async () => {
    if (!name.trim() || !privateKeyPem.trim()) return;
    Keyboard.dismiss();
    setLoading(true);

    try {
      // The private key is the source of truth. For unencrypted OpenSSH keys
      // this recovers the real public key and fingerprint, so an imported key
      // is as verifiable as a generated one instead of carrying a placeholder.
      const parsedPrivate = SSHKeyManager.parsePrivateKey(privateKeyPem);

      let publicKey = parsedPrivate.publicKey;
      let fingerprint = parsedPrivate.fingerprint;
      let algorithm = parsedPrivate.algorithm;
      let comment = parsedPrivate.comment;

      if (publicKeyStr.trim()) {
        const parsedPublic = SSHKeyManager.parsePublicKey(publicKeyStr);

        // A pasted public key that does not belong to the pasted private key
        // would produce an identity that can never authenticate.
        if (fingerprint && parsedPublic.fingerprint !== fingerprint) {
          throw new Error(
            'The public key you pasted does not match the private key. Leave it blank to derive it automatically.'
          );
        }

        publicKey = publicKeyStr.trim();
        fingerprint = parsedPublic.fingerprint;
        algorithm = parsedPublic.algorithm;
        comment = parsedPublic.comment ?? comment;
      }

      if (!publicKey || !fingerprint) {
        throw new Error(
          parsedPrivate.isEncrypted
            ? 'This key is passphrase-protected, so its public half cannot be derived. Paste the matching .pub file as well.'
            : 'Could not determine the public key. Paste the matching .pub file as well.'
        );
      }

      if (requireBiometrics && !(await SecureStorageService.isBiometricAvailable())) {
        throw new Error('No biometric enrolment was found on this device.');
      }

      const existing = await HostStorageService.getIdentities();
      const duplicate = existing.find(i => i.fingerprint === fingerprint);
      if (duplicate) {
        throw new Error(`This key is already imported as "${duplicate.name}".`);
      }

      const id = `id_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const identity: SSHIdentity = {
        id,
        name: name.trim(),
        algorithm,
        publicKey,
        privateKeySecureReference: `ssh_key_${id}`,
        fingerprint,
        comment,
        hasPassphrase: parsedPrivate.isEncrypted,
        requiresBiometrics: requireBiometrics,
        createdAt: new Date().toISOString(),
      };

      await HostStorageService.saveIdentity(identity, privateKeyPem.trim());
      onImported();
      reset();
      onClose();
    } catch (err) {
      Alert.alert('Import Failed', err instanceof Error ? err.message : 'The key could not be imported.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalOverlay style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Download size={20} color={colors.primary} />
              <Text style={[styles.title, { color: colors.text }]}>Import SSH Key</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close key dialog" style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
                <X size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: colors.textMuted }]}>Key Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. prod_deploy_key"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { color: colors.textMuted }]}>Private Key (OpenSSH or PEM)</Text>
            <TouchableOpacity style={styles.fileButton} accessibilityRole="button" onPress={() => loadKeyFile('private')}>
              <Text style={{ color: colors.primary }}>Choose private key file</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              accessibilityLabel="Private key"
              value={privateKeyPem}
              onChangeText={setPrivateKeyPem}
              placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
              placeholderTextColor={colors.textSubtle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { color: colors.textMuted }]}>
              Public Key (optional — derived automatically when possible)
            </Text>
            <TouchableOpacity style={styles.fileButton} accessibilityRole="button" onPress={() => loadKeyFile('public')}>
              <Text style={{ color: colors.primary }}>Choose public key (.pub) file</Text>
            </TouchableOpacity>
            <TextInput
              accessibilityLabel="Public key"
              style={[styles.textArea, { height: 120, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              value={publicKeyStr}
              onChangeText={setPublicKeyStr}
              placeholder="ssh-ed25519 AAAAC3... user@example.com"
              placeholderTextColor={colors.textSubtle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Require biometrics to use</Text>
                <Text style={[styles.switchHint, { color: colors.textMuted }]}>
                  The keystore checks Face ID / fingerprint each time this key is read.
                </Text>
              </View>
              <Switch value={requireBiometrics} onValueChange={setRequireBiometrics} />
            </View>

            <View style={[styles.notice, { backgroundColor: colors.surfaceSubtle }]}>
              <Lock size={13} color={colors.textMuted} />
              <Text style={[styles.noticeText, { color: colors.textMuted }]}>
                The private key is written straight to the device keychain. Temporary import files are removed after reading. Your keys never leave the device.
              </Text>
            </View>

          </ScrollView>
            <TouchableOpacity
              style={[
                styles.importButton,
                { backgroundColor: colors.primary, opacity: name.trim() && privateKeyPem.trim() ? 1 : 0.5 },
              ]}
              onPress={handleImport}
              disabled={loading || !name.trim() || !privateKeyPem.trim()}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.importBtnText}>Import into Secure Storage</Text>
              )}
            </TouchableOpacity>
        </View>
      </ModalOverlay>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    padding: 20,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  card: {
    maxHeight: '100%',
    flexShrink: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  scroll: {
    flexShrink: 1,
    flexGrow: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  fileButton: { minHeight: 48, justifyContent: 'center' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 11,
    fontFamily: 'monospace',
    height: 110,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  switchLabelWrap: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  switchHint: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  notice: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  importButton: {
    minHeight: 48,
    marginTop: 16,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  importBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
