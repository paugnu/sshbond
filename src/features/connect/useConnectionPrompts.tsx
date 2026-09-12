import { ModalOverlay } from '../common/KeyboardAwareModal';
import { FormInput as TextInput, FormScrollView } from '../common/FormControls';
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { ShieldAlert, ShieldQuestion, KeyRound } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { ConnectOptions, HostKeyChallenge } from '@/services/ssh/SSHClient';

interface PendingHostKey {
  challenge: HostKeyChallenge;
  resolve: (accepted: boolean) => void;
}

interface PendingSecret {
  title: string;
  prompt: string;
  resolve: (value: string | null) => void;
}

/**
 * Bridges the SSH engine's callback-shaped prompts to modal UI.
 *
 * `SSHClient` refuses to continue when it cannot ask the user about an
 * unverified host key, so any screen that connects must render these prompts.
 */
export function useConnectionPrompts(): {
  connectOptions: ConnectOptions;
  prompts: React.ReactElement;
} {
  const { colors } = useTheme();
  const [hostKey, setHostKey] = useState<PendingHostKey | null>(null);
  const [secret, setSecret] = useState<PendingSecret | null>(null);
  const [secretValue, setSecretValue] = useState('');

  const connectOptions = useMemo<ConnectOptions>(
    () => ({
      onHostKeyChallenge: challenge =>
        new Promise<boolean>(resolve => setHostKey({ challenge, resolve })),
      onPasswordRequired: prompt =>
        new Promise<string | null>(resolve =>
          setSecret({ title: 'Password Required', prompt, resolve })
        ),
      onPassphraseRequired: keyName =>
        new Promise<string | null>(resolve =>
          setSecret({
            title: 'Key Passphrase Required',
            prompt: `Enter the passphrase for "${keyName}"`,
            resolve,
          })
        ),
    }),
    []
  );

  const answerHostKey = useCallback(
    (accepted: boolean) => {
      hostKey?.resolve(accepted);
      setHostKey(null);
    },
    [hostKey]
  );

  const answerSecret = useCallback(
    (value: string | null) => {
      secret?.resolve(value);
      setSecret(null);
      setSecretValue('');
    },
    [secret]
  );

  const prompts = (
    <>
      <Modal visible={hostKey !== null} transparent animationType="fade" onRequestClose={() => answerHostKey(false)}>
        <ModalOverlay style={styles.overlay}>
          <FormScrollView style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {hostKey?.challenge.isMismatch ? (
              <>
                <View style={styles.header}>
                  <ShieldAlert size={22} color={colors.error} />
                  <Text style={[styles.title, { color: colors.error }]}>Host Key Changed</Text>
                </View>
                <Text style={[styles.body, { color: colors.text }]}>
                  The key offered by {hostKey.challenge.hostname}:{hostKey.challenge.port} does not match the
                  one you trusted before. This is what a man-in-the-middle attack looks like. It can also
                  happen after a legitimate server rebuild — only continue if you know that is the case.
                </Text>
                <FingerprintRow label="Expected" value={hostKey.challenge.storedFingerprint ?? '—'} />
                <FingerprintRow label="Received" value={hostKey.challenge.fingerprint} highlight />
              </>
            ) : (
              <>
                <View style={styles.header}>
                  <ShieldQuestion size={22} color={colors.warning} />
                  <Text style={[styles.title, { color: colors.text }]}>Unknown Host</Text>
                </View>
                <Text style={[styles.body, { color: colors.text }]}>
                  {hostKey?.challenge.hostname}:{hostKey?.challenge.port} has never been connected to before.
                  Verify the fingerprint out of band before trusting it.
                </Text>
                <FingerprintRow label={hostKey?.challenge.algorithm ?? 'key'} value={hostKey?.challenge.fingerprint ?? ''} />
              </>
            )}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, { borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => answerHostKey(false)}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: hostKey?.challenge.isMismatch ? colors.error : colors.primary },
                ]}
                onPress={() => answerHostKey(true)}
              >
                <Text style={[styles.buttonText, { color: '#ffffff' }]}>
                  {hostKey?.challenge.isMismatch ? 'Trust Anyway' : 'Trust & Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          </FormScrollView>
        </ModalOverlay>
      </Modal>

      <Modal visible={secret !== null} transparent animationType="fade" onRequestClose={() => answerSecret(null)}>
        <ModalOverlay style={styles.overlay}>
          <FormScrollView style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.header}>
              <KeyRound size={20} color={colors.primary} />
              <Text style={[styles.title, { color: colors.text }]}>{secret?.title}</Text>
            </View>
            <Text style={[styles.body, { color: colors.textMuted }]}>{secret?.prompt}</Text>

            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
              ]}
              value={secretValue}
              onChangeText={setSecretValue}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={() => answerSecret(secretValue)}
            />

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, { borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => answerSecret(null)}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={() => answerSecret(secretValue)}
              >
                <Text style={[styles.buttonText, { color: '#ffffff' }]}>Continue</Text>
              </TouchableOpacity>
            </View>
          </FormScrollView>
        </ModalOverlay>
      </Modal>
    </>
  );

  return { connectOptions, prompts };
}

const FingerprintRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight,
}) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.fingerprintBox, { backgroundColor: colors.surfaceSubtle }]}>
      <Text style={[styles.fingerprintLabel, { color: colors.textSubtle }]}>{label.toUpperCase()}</Text>
      <Text
        style={[styles.fingerprintValue, { color: highlight ? colors.error : colors.text }]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: '100%',
    width: '100%',
    maxWidth: 460,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  fingerprintBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  fingerprintLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  fingerprintValue: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  button: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
