import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

interface GroupHeaderProps {
  title: string;
  count: number;
}

export const GroupHeader: React.FC<GroupHeaderProps> = ({ title, count }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
      <Text style={[styles.count, { color: colors.textSubtle }]}>{count}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 2,
    marginTop: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  count: {
    fontSize: 11,
    fontWeight: '600',
  },
});
