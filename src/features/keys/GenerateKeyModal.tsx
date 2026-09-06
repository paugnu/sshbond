import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import { ModalOverlay } from '../common/KeyboardAwareModal';
import { useTheme } from '../../theme/ThemeContext';
import { SSHKeyAlgorithm } from '@/domain/models/sshConfig';
import { SSHKeyManager, GENERATABLE_ALGORITHMS } from '@/services/ssh/keys/SSHKeyManager';
import { HostStorageService } from '@/services/persistence/HostStorageService';
import { SecureStorageService } from '@/services/secureStorage/SecureStorageService';
import { ShieldCheck, X, Info } from 'lucide-react-native';

interface GenerateKeyModalProps {
  visible: boolean;
  onClose: () => void;
  onGenerated: () => void;
}

const ALGORITHM_LABELS: Record<SSHKeyAlgorithm, string> = {
  ed25519: 'Ed25519 (recommended)',
  rsa: 'RSA',
  ecdsa: 'ECDSA',
};

export const GenerateKeyModal: React.FC<GenerateKeyModalProps> = ({ visible, onClose, onGenerated }) => {
  const { colors } = useTheme();
  const [name, setName] = useState('id_ed25519');
  const [algorithm, setAlgorithm] = useState<SSHKeyAlgorithm>('ed25519');
  const [comment, setComment] = useState('');
  const [requireBiometrics, setRequireBiometrics] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('id_ed25519');
    setAlgorithm('ed25519');
    setComment('');
    setRequireBiometrics(false);
  };

  const handleGenerate = async () => {
    if (!name.trim()) return;
    setLoading(true);

    try {
      if (requireBiometrics && !(await SecureStorageService.isBiometricAvailable())) {
        throw new Error('No biometric enrolment was found on this device.');
      }

      const generated = await SSHKeyManager.generateKeyPair({
        name: name.trim(),
        algorithm,
        comment: comment.trim() || undefined,
        requireBiometrics,
      });

      await HostStorageService.saveIdentity(generated.identity, generated.privateKey);
      onGenerated();
      reset();
      onClose();
    } catch (err) {
      Alert.alert(
        'Key Generation Failed',
        err instanceof Error ? err.message : 'The key could not be generated.'
      );
    } finally {
      setLoading(false);
    }
  };

  const canGenerate = GENERATABLE_ALGORITHMS.includes(algorithm);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalOverlay style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ShieldCheck size={20} color={colors.primary} />
              <Text style={[styles.title, { color: colors.text }]}>Generate SSH Key</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close key dialog" style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
              <X size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.textMuted }]}>Key Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. id_ed25519"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>Algorithm</Text>
          <View style={styles.algoRow}>
            {(Object.keys(ALGORITHM_LABELS) as SSHKeyAlgorithm[]).map(algo => {
              const selected = algorithm === algo;
              const supported = GENERATABLE_ALGORITHMS.includes(algo);
              return (
                <TouchableOpacity
                  key={algo}
                  style={[
                    styles.algoBtn,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
                      borderColor: selected ? colors.primary : colors.border,
                      opacity: supported ? 1 : 0.55,
                    },
                  ]}
                  onPress={() => {
                    setAlgorithm(algo);
                    if (name.startsWith('id_')) setName(`id_${algo}`);
                  }}
                >
                  <Text style={[styles.algoBtnText, { color: selected ? '#ffffff' : colors.text }]}>
                    {ALGORITHM_LABELS[algo]}
                    {supported ? '' : ' — import only'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!canGenerate && (
            <View style={[styles.notice, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <Info size={14} color={colors.warning} />
              <Text style={[styles.noticeText, { color: colors.textMuted }]}>
                SSHBond does not generate {algorithm.toUpperCase()} keys on device, because it has no
                audited implementation to do it with. Create one with{' '}
                <Text style={{ fontFamily: 'monospace', color: colors.text }}>
                  ssh-keygen -t {algorithm}
                </Text>{' '}
                and import it instead.
              </Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.textMuted }]}>Comment</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            value={comment}
            onChangeText={setComment}
            placeholder="e.g. pau@iphone"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.switchRow}>
            <View style={styles.switchLabelWrap}>
              <Text style={[styles.switchLabel, { color: colors.text }]}>Require biometrics to use</Text>
              <Text style={[styles.switchHint, { color: colors.textMuted }]}>
                Face ID / fingerprint is checked by the keystore each time this key is read.
              </Text>
            </View>
            <Switch value={requireBiometrics} onValueChange={setRequireBiometrics} />
          </View>

          <TouchableOpacity
            style={[
              styles.genButton,
              { backgroundColor: colors.primary, opacity: canGenerate && name.trim() ? 1 : 0.5 },
            ]}
            onPress={handleGenerate}
            disabled={loading || !name.trim() || !canGenerate}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.genBtnText}>Generate &amp; Store in Keychain</Text>
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
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  algoRow: {
    flexDirection: 'column',
    gap: 6,
  },
  algoBtn: {
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  algoBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  notice: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginTop: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
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
  genButton: {
    minHeight: 48,
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  genBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
