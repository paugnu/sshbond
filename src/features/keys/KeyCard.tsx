import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SSHIdentity } from '@/domain/models/sshConfig';
import { useTheme } from '../../theme/ThemeContext';
import { Key, Copy, Share2, Trash2, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

interface KeyCardProps {
  identity: SSHIdentity;
  onDelete: () => void;
  onShare: () => void;
}

export const KeyCard: React.FC<KeyCardProps> = ({ identity, onDelete, onShare }) => {
  const { colors } = useTheme();

  const handleCopy = async () => {
    await Clipboard.setStringAsync(identity.publicKey);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.left}>
          <View style={[styles.iconWrapper, { backgroundColor: colors.surfaceSubtle }]}>
            <Key size={16} color={colors.primary} />
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={[styles.name, { color: colors.text }]}>{identity.name}</Text>
              <View style={[styles.algoBadge, { backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[styles.algoText, { color: colors.primary }]}>
                  {identity.algorithm.toUpperCase()} {identity.keySize || ''}
                </Text>
              </View>
              {identity.hasPassphrase && (
                <Lock size={12} color={colors.warning} />
              )}
            </View>
            {identity.comment && (
              <Text style={[styles.comment, { color: colors.textMuted }]}>{identity.comment}</Text>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border }]}
            onPress={handleCopy}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Copy size={14} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border }]}
            onPress={onShare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Share2 size={14} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border }]}
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Trash2 size={14} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.fingerprintBox, { backgroundColor: colors.surfaceSubtle }]}>
        <Text style={[styles.fpLabel, { color: colors.textSubtle }]}>FINGERPRINT</Text>
        <Text style={[styles.fpText, { color: colors.textMuted }]} numberOfLines={1}>
          {identity.fingerprint}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  algoBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  algoText: {
    fontSize: 10,
    fontWeight: '700',
  },
  comment: {
    fontSize: 12,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fingerprintBox: {
    marginTop: 10,
    padding: 8,
    borderRadius: 6,
  },
  fpLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fpText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
