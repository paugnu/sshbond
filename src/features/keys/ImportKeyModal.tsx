import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { ModalOverlay, DismissKeyboardButton } from '../common/KeyboardAwareModal';
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

  const handleImport = async () => {
    if (!name.trim() || !privateKeyPem.trim()) return;
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
              <DismissKeyboardButton color={colors.primary} />
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
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
            <TextInput
              style={[styles.textArea, { height: 60, backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
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
                The private key is written straight to the device keychain. It is never copied
                anywhere else and never leaves the device.
              </Text>
            </View>

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
          </ScrollView>
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
    maxHeight: '85%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  scroll: {
    flexGrow: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
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
