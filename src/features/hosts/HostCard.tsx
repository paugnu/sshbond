import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ReanimatedSwipeable, {
  SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SSHHost } from '@/domain/models/sshConfig';
import { useTheme } from '../../theme/ThemeContext';
import { Server, Star, ArrowRight, GitBranch, Edit, Trash2 } from 'lucide-react-native';

interface HostCardProps {
  host: SSHHost;
  onPress: () => void;
  onLongPress: () => void;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const HostCard: React.FC<HostCardProps> = ({
  host,
  onPress,
  onLongPress,
  onToggleFavorite,
  onEdit,
  onDelete,
}) => {
  const { colors } = useTheme();
  const swipeable = useRef<SwipeableMethods | null>(null);

  /**
   * Runs an action and slides the row back.
   *
   * Leaving it open would mean returning from the editor to a row still
   * showing a Delete button under a host that may no longer be there.
   */
  const runAction = (action: () => void) => {
    swipeable.current?.close();
    action();
  };

  const renderRightActions = () => (
    <View style={styles.actions}>
      <TouchableOpacity
        style={[styles.action, { backgroundColor: colors.primary }]}
        onPress={() => runAction(onEdit)}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${host.alias}`}
      >
        <Edit size={18} color="#ffffff" />
        <Text style={styles.actionText}>Edit</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.action, { backgroundColor: colors.error }]}
        onPress={() => runAction(onDelete)}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${host.alias}`}
      >
        <Trash2 size={18} color="#ffffff" />
        <Text style={styles.actionText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      containerStyle={styles.swipeContainer}
      renderRightActions={renderRightActions}
      // The row stops where the buttons end: bouncing past them suggests a
      // third action that is not there.
      overshootRight={false}
      friction={2}
      rightThreshold={40}
    >
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.left}>
        <View style={[styles.iconWrapper, { backgroundColor: colors.surfaceSubtle }]}>
          <Server size={18} color={colors.primary} />
        </View>

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={[styles.alias, { color: colors.text }]}>{host.alias}</Text>
            {host.proxyJump && (
              <View style={[styles.proxyBadge, { backgroundColor: colors.surfaceSubtle }]}>
                <GitBranch size={10} color={colors.textMuted} />
                <Text style={[styles.proxyText, { color: colors.textMuted }]}>via {host.proxyJump}</Text>
              </View>
            )}
          </View>

          <Text style={[styles.details, { color: colors.textMuted }]}>
            {host.username ? `${host.username}@` : ''}
            {host.hostname}
            {host.port && host.port !== 22 ? `:${host.port}` : ''}
          </Text>

          {host.tags && host.tags.length > 0 && (
            <View style={styles.tagList}>
              {host.tags.map((tag, i) => (
                <View key={i} style={[styles.tagBadge, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text style={[styles.tagText, { color: colors.textSubtle }]}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={styles.right}>
        <TouchableOpacity
          onPress={onToggleFavorite}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.starButton}
        >
          <Star
            size={16}
            color={host.favorite ? colors.warning : colors.textSubtle}
            fill={host.favorite ? colors.warning : 'transparent'}
          />
        </TouchableOpacity>

        <ArrowRight size={16} color={colors.textSubtle} />
      </View>
    </TouchableOpacity>
    </ReanimatedSwipeable>
  );
};

const styles = StyleSheet.create({
  swipeContainer: {
    marginBottom: 8,
    borderRadius: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  action: {
    width: 76,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alias: {
    fontSize: 15,
    fontWeight: '600',
  },
  proxyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  proxyText: {
    fontSize: 11,
  },
  details: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  tagList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 10,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 8,
  },
  starButton: {
    padding: 4,
  },
});
