import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { SecureStorageService } from '../services/secureStorage/SecureStorageService';
import { HostStorageService } from '../services/persistence/HostStorageService';
import { ShieldCheck, Lock } from 'lucide-react-native';

function RootLayoutContent() {
  const { colors, isDark } = useTheme();
  const [isLocked, setIsLocked] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkBiometricLock();
  }, []);

  const checkBiometricLock = async () => {
    try {
      const settings = await HostStorageService.getSettings();
      if (settings.requireBiometrics) {
        setIsLocked(true);
        const unlocked = await SecureStorageService.promptBiometrics('Unlock SSHBond');
        if (unlocked) {
          setIsLocked(false);
        }
      }
    } catch {
      // Ignored
    } finally {
      setCheckingAuth(false);
    }
  };

  if (checkingAuth) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isLocked) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.lockIcon, { backgroundColor: colors.surfaceSubtle }]}>
          <Lock size={36} color={colors.primary} />
        </View>
        <Text style={[styles.lockTitle, { color: colors.text }]}>SSHBond Locked</Text>
        <Text style={[styles.lockSubtitle, { color: colors.textMuted }]}>
          Biometric verification is required to access your SSH keys and hosts.
        </Text>
        <TouchableOpacity
          style={[styles.unlockBtn, { backgroundColor: colors.primary }]}
          onPress={checkBiometricLock}
        >
          <ShieldCheck size={18} color="#ffffff" />
          <Text style={styles.unlockBtnText}>Unlock with Biometrics</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
    </>
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
