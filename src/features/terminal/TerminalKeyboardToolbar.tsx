import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/ThemeContext';

interface TerminalKeyboardToolbarProps {
  onSendKey: (keyData: string) => void;
  hapticFeedback?: boolean;
}

export const TerminalKeyboardToolbar: React.FC<TerminalKeyboardToolbarProps> = ({
  onSendKey,
  hapticFeedback = true,
}) => {
  const { colors } = useTheme();
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  const handleKeyPress = (label: string, value: string) => {
    if (hapticFeedback) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (label === 'CTRL') {
      setCtrlActive(prev => !prev);
      return;
    }
    if (label === 'ALT') {
      setAltActive(prev => !prev);
      return;
    }

    let payload = value;

    // Ctrl and Alt compose: Ctrl+Alt+C must send ESC followed by 0x03, so the
    // modifiers are applied in sequence rather than as alternatives.
    if (ctrlActive) {
      if (value.length === 1) {
        const code = value.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          payload = String.fromCharCode(code - 64);
        } else if (code === 32) {
          payload = '\x00'; // Ctrl+Space is NUL
        }
      }
      setCtrlActive(false);
    }

    if (altActive) {
      payload = '\x1b' + payload;
      setAltActive(false);
    }

    onSendKey(payload);
  };

  const quickKeys = [
    { label: 'ESC', value: '\x1b' },
    { label: 'TAB', value: '\t' },
    { label: 'CTRL', value: '', isToggle: true, active: ctrlActive },
    { label: 'ALT', value: '', isToggle: true, active: altActive },
    { label: 'Ctrl+C', value: '\x03' },
    { label: 'Ctrl+D', value: '\x04' },
    { label: 'Ctrl+Z', value: '\x1a' },
    { label: 'Ctrl+L', value: '\x0c' },
    { label: 'Ctrl+A', value: '\x01' },
    { label: 'Ctrl+E', value: '\x05' },
    { label: '↑', value: '\x1b[A' },
    { label: '↓', value: '\x1b[B' },
    { label: '←', value: '\x1b[D' },
    { label: '→', value: '\x1b[C' },
    { label: '|', value: '|' },
    { label: '/', value: '/' },
    { label: '_', value: '_' },
    { label: '~', value: '~' },
    { label: '`', value: '`' },
    { label: 'HOME', value: '\x1b[H' },
    { label: 'END', value: '\x1b[F' },
    { label: 'PGUP', value: '\x1b[5~' },
    { label: 'PGDN', value: '\x1b[6~' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSubtle, borderTopColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {quickKeys.map((item, idx) => {
          const isActive = item.isToggle && item.active;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.keyButton,
                { backgroundColor: isActive ? colors.primary : colors.surface, borderColor: colors.border },
              ]}
              onPress={() => handleKeyPress(item.label, item.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.keyText,
                  { color: isActive ? '#ffffff' : colors.text },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 44,
    borderTopWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 6,
  },
  keyButton: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 36,
  },
  keyText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
