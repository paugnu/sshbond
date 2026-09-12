import { FormInput as TextInput } from '../common/FormControls';
import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Zap, Plus } from 'lucide-react-native';

interface QuickConnectBarProps {
  onConnect: (connectionString: string) => void;
  onSave: (connectionString: string) => void;
}

export const QuickConnectBar: React.FC<QuickConnectBarProps> = ({ onConnect, onSave }) => {
  const { colors } = useTheme();
  const [value, setValue] = useState('');

  const handleConnect = () => {
    if (!value.trim()) return;
    onConnect(value.trim());
  };

  const handleSave = () => {
    if (!value.trim()) return;
    onSave(value.trim());
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        accessibilityLabel="SSH connection address"
        style={[styles.input, { color: colors.text }]}
        placeholder="user@host:port (e.g. pau@192.168.1.50)"
        placeholderTextColor={colors.textSubtle}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={handleConnect}
      />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleConnect}
          disabled={!value.trim()}
          activeOpacity={0.8}
        >
          <Zap size={14} color="#ffffff" />
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Save host from quick connect"
          onPress={handleSave}
          disabled={!value.trim()}
          activeOpacity={0.8}
        >
          <Plus size={14} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  input: {
    minHeight: 48,
    flex: 1,
    fontSize: 13,
    fontFamily: 'monospace',
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  button: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
