import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { AlertTriangle } from 'lucide-react-native';

interface MultilinePasteModalProps {
  visible: boolean;
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const MultilinePasteModal: React.FC<MultilinePasteModalProps> = ({
  visible,
  text,
  onConfirm,
  onCancel,
}) => {
  const { colors } = useTheme();
  const lineCount = text.split('\n').length;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <AlertTriangle size={20} color={colors.warning} />
            <Text style={[styles.title, { color: colors.text }]}>Confirm Multiline Paste</Text>
          </View>

          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            You are about to paste {lineCount} lines into the active terminal session.
          </Text>

          <View style={[styles.previewContainer, { backgroundColor: colors.background, borderColor: colors.borderSubtle }]}>
            <ScrollView style={styles.previewScroll}>
              <Text style={[styles.previewText, { color: colors.text }]}>{text}</Text>
            </ScrollView>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { borderColor: colors.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.pasteButton, { backgroundColor: colors.primary }]}
              onPress={onConfirm}
            >
              <Text style={[styles.buttonText, { color: '#ffffff' }]}>Paste</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  previewContainer: {
    maxHeight: 160,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  previewScroll: {
    flexGrow: 0,
  },
  previewText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  button: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  pasteButton: {},
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
