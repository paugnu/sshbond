import React, { useEffect, useState, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, Keyboard, Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { SecureStorageService } from '../services/secureStorage/SecureStorageService';
import { HostStorageService } from '../services/persistence/HostStorageService';
import { ShieldCheck, Lock } from 'lucide-react-native';
import { AppLockController, AppLockState } from '../services/secureStorage/AppLockController';

function RootLayoutContent() {
  const { colors, isDark } = useTheme();
  const [lockState, setLockState] = useState<AppLockState>('checking');
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const lockController = useRef<AppLockController | null>(null);

  useEffect(() => {
    const controller = new AppLockController(
      async () => (await HostStorageService.getSettings()).requireBiometrics,
      () => SecureStorageService.promptBiometrics('Unlock SSHBond'),
      state => {
        setLockState(state);
        if (state === 'unlocked') setHasUnlocked(true);
      },
    );
    lockController.current = controller;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') Keyboard.dismiss();
      controller.onAppStateChange(state);
    });
    void controller.unlock();
    return () => {
      subscription.remove();
      controller.dispose();
      lockController.current = null;
    };
  }, []);

  let lockScreen: React.ReactNode = null;
  if (lockState === 'checking') {
    lockScreen = (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (lockState === 'locked') {
    lockScreen = (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.lockIcon, { backgroundColor: colors.surfaceSubtle }]}>
          <Lock size={36} color={colors.primary} />
        </View>
        <Text style={[styles.lockTitle, { color: colors.text }]}>SSHBond Locked</Text>
        <Text style={[styles.lockSubtitle, { color: colors.textMuted }]}>
          Unlock to access your SSH keys and hosts. If authentication fails, check your device security settings and try again.
        </Text>
        <TouchableOpacity
          style={[styles.unlockBtn, { backgroundColor: colors.primary }]}
          onPress={() => void lockController.current?.unlock()}
        >
          <ShieldCheck size={18} color="#ffffff" />
          <Text style={styles.unlockBtnText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {hasUnlocked && <View
        style={[styles.root, lockState !== 'unlocked' && { opacity: 0 }]}
        pointerEvents={lockState === 'unlocked' ? 'auto' : 'none'}
        accessibilityElementsHidden={lockState !== 'unlocked'}
        importantForAccessibility={lockState !== 'unlocked' ? 'no-hide-descendants' : 'auto'}
      >
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="host/[id]"
          options={{
            title: 'Edit Host',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="host/new"
          options={{
            title: 'New Host',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="terminal/[sessionId]"
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
      </Stack>
      </View>}
      <Modal visible={lockState !== 'unlocked'} animationType="none" onRequestClose={() => {}}>
        {lockScreen}
      </Modal>
    </View>
  );
}

export default function RootLayout() {
  return (
    // Gesture handlers -- the swipe actions on a host row among them -- are
    // inert outside this view on Android, and it has to sit above everything.
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <RootLayoutContent />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  lockTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  lockSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  unlockBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
