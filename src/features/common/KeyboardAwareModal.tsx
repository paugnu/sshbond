import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';

/**
 * True while the soft keyboard is on screen.
 *
 * iOS announces the keyboard early enough to move with it; Android only reports
 * it once it is up, so the two platforms listen to different events.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(showEvent, () => setVisible(true));
    const hidden = Keyboard.addListener(hideEvent, () => setVisible(false));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}

interface ModalOverlayProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The dimmed backdrop a modal card sits on, with the keyboard handled.
 *
 * Two things it does that a plain `View` does not:
 *
 * 1. It shrinks the available space when the keyboard opens, so the card's
 *    action button stays on screen instead of being pushed underneath it.
 * 2. It puts the keyboard away when the backdrop is tapped. A multiline field
 *    has no return key to dismiss it with -- return inserts a newline -- so
 *    without this there is no way back out of a text area.
 */
export const ModalOverlay: React.FC<ModalOverlayProps> = ({ children, style }) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <KeyboardAvoidingView style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[{ flex: 1, justifyContent: 'center' }, style,
        { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}
          accessibilityRole="button" accessibilityLabel="Dismiss keyboard" />
        {children}
        <DismissKeyboardButton color={colors.primary} />
      </View>
    </KeyboardAvoidingView>
  );
};

/**
 * An explicit way out of a text area, shown only while the keyboard is up.
 *
 * Tapping outside works too, but a visible control is the one people look for
 * when a keyboard is covering half the screen.
 */
export const DismissKeyboardButton: React.FC<{ color: string }> = ({ color }) => {
  const keyboardVisible = useKeyboardVisible();
  if (!keyboardVisible) return null;

  return (
    <TouchableOpacity
      onPress={Keyboard.dismiss}
      style={styles.doneButton}
      accessibilityLabel="Hide keyboard"
      accessibilityRole="button"
    >
      <Text style={[styles.doneText, { color }]}>Hide keyboard</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
  },
  doneButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },
  doneText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
