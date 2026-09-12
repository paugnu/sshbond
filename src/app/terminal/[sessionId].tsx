import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useKeyboardVisible } from '../../features/common/KeyboardAwareModal';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';
import { SessionManager } from '../../features/terminal/SessionManager';
import { TerminalView, TerminalHandle } from '../../features/terminal/TerminalView';
import { TerminalKeyboardToolbar } from '../../features/terminal/TerminalKeyboardToolbar';
import { MultilinePasteModal } from '../../features/terminal/MultilinePasteModal';
import { HostStorageService, AppSettings } from '../../services/persistence/HostStorageService';
import { ISSHConnection } from '../../services/ssh/SSHConnection';
import { SSHSessionInfo } from '@/domain/models/sshConfig';
import { ArrowLeft, XCircle, ClipboardPaste, Info } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'sshbond-session';

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { colors, terminalPalette } = useTheme();
  const terminalRef = useRef<TerminalHandle>(null);
  const keyboardVisible = useKeyboardVisible();

  const [connection, setConnection] = useState<ISSHConnection | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SSHSessionInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Re-measured once the keyboard has finished moving: fitting while it is
  // still animating sizes the grid to a height that is already out of date.
  useEffect(() => {
    const timer = setTimeout(() => terminalRef.current?.fit(), 250);
    return () => clearTimeout(timer);
  }, [keyboardVisible]);

  const [pendingPasteText, setPendingPasteText] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const sync = () => {
      setConnection(SessionManager.getConnection(sessionId) ?? null);
      setSessionInfo(SessionManager.getSessionInfo(sessionId) ?? null);
    };

    sync();
    return SessionManager.subscribe(sync);
  }, [sessionId]);

  useEffect(() => {
    HostStorageService.getSettings().then(setSettings);
  }, []);

  // Screen-lock during a long-running command drops the PTY on some devices,
  // which is exactly when the user least wants to lose the session.
  useEffect(() => {
    if (!settings?.keepAwakeDuringSession || !connection) return;

    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [settings?.keepAwakeDuringSession, connection]);

  const haptic = useCallback(
    (fn: () => void) => {
      if (settings?.hapticFeedback !== false) fn();
    },
    [settings?.hapticFeedback]
  );

  const handleSendKey = useCallback(
    (keyData: string) => {
      void connection?.sendInput(keyData).catch(() => undefined);
    },
    [connection]
  );

  const handlePasteClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;

    // A multi-line paste executes every line the moment it lands in the shell;
    // confirming first is the only chance to catch a mis-copied command.
    if (settings?.confirmMultilinePaste !== false && text.includes('\n')) {
      setPendingPasteText(text);
      return;
    }

    await connection?.sendInput(text).catch(() => undefined);
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  }, [connection, settings?.confirmMultilinePaste, haptic]);

  const handleConfirmPaste = useCallback(() => {
    if (pendingPasteText) {
      void connection?.sendInput(pendingPasteText).catch(() => undefined);
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    }
    setPendingPasteText(null);
  }, [connection, pendingPasteText, haptic]);

  const handleDisconnectAndClose = useCallback(() => {
    if (!sessionId) return;

    Alert.alert('Close Session', 'Disconnect from this host?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await SessionManager.closeSession(sessionId);
          router.back();
        },
      },
    ]);
  }, [sessionId, router]);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!sessionInfo || !connection) return;

    // Deliberately excludes the username, any credential and the host key, so
    // the result is safe to paste into a bug report.
    const diagnostics = [
      '=== SSHBond Session Diagnostics ===',
      `Status: ${sessionInfo.status}`,
      `Port: ${sessionInfo.port}`,
      `Started At: ${sessionInfo.startedAt}`,
      `StrictHostKeyChecking: ${connection.config.strictHostKeyChecking}`,
      `Compression: ${connection.config.compression}`,
      `ServerAliveInterval: ${connection.config.serverAliveInterval}s`,
      `ConnectTimeout: ${connection.config.connectTimeout}s`,
      `RequestTTY: ${connection.config.requestTTY}`,
      `ProxyJump: ${connection.config.proxyJump ? 'configured' : 'none'}`,
      `Local forwards: ${connection.config.localForwards.length}`,
      `Remote forwards: ${connection.config.remoteForwards.length}`,
      `Dynamic forwards: ${connection.config.dynamicForwards.length}`,
      sessionInfo.errorMessage ? `Last error: ${sessionInfo.errorMessage}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await Clipboard.setStringAsync(diagnostics);
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    Alert.alert('Diagnostics Copied', 'Hostnames, usernames and credentials were left out.');
  }, [sessionInfo, connection, haptic]);

  if (!connection || !sessionInfo) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.notFoundText, { color: colors.text }]}>Session not found or closed.</Text>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={styles.backBtnText}>Return to Hosts</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const statusColor =
    sessionInfo.status === 'connected'
      ? colors.success
      : sessionInfo.status === 'error'
        ? colors.error
        : colors.warning;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: terminalPalette.background }]}>
      {/*
        Without this the keyboard sits on top of the terminal: iOS never resizes
        a view for it. Shrinking the screen instead makes xterm reflow to the
        space that is left, so the prompt stays visible while typing.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.titleRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.hostTitle, { color: colors.text }]} numberOfLines={1}>
              {sessionInfo.hostAlias}
            </Text>
          </View>
          <Text style={[styles.hostSub, { color: colors.textMuted }]} numberOfLines={1}>
            {sessionInfo.username ? `${sessionInfo.username}@` : ''}
            {sessionInfo.hostname}:{sessionInfo.port} • {sessionInfo.status}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionBtn} onPress={handleCopyDiagnostics}>
            <Info size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionBtn} onPress={handlePasteClipboard}>
            <ClipboardPaste size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionBtn} onPress={handleDisconnectAndClose}>
            <XCircle size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      {sessionInfo.errorMessage && (
        <View style={[styles.errorBar, { backgroundColor: colors.error }]}>
          <Text style={styles.errorBarText} numberOfLines={2}>
            {sessionInfo.errorMessage}
          </Text>
        </View>
      )}

      <View style={styles.terminalContainer}>
        <TerminalView
          ref={terminalRef}
          connection={connection}
          fontSize={settings?.terminalFontSize}
          fontFamily={settings?.terminalFontFamily}
          cursorStyle={settings?.cursorStyle}
        />
      </View>

      <TerminalKeyboardToolbar
        onSendKey={handleSendKey}
        onHideKeyboard={keyboardVisible ? () => { terminalRef.current?.blur(); Keyboard.dismiss(); } : undefined}
        hapticFeedback={settings?.hapticFeedback !== false}
      />
      </KeyboardAvoidingView>

      <MultilinePasteModal
        visible={pendingPasteText !== null}
        text={pendingPasteText ?? ''}
        onConfirm={handleConfirmPaste}
        onCancel={() => setPendingPasteText(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerBtn: {
    padding: 6,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hostTitle: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  hostSub: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActionBtn: {
    padding: 6,
  },
  errorBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  errorBarText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  terminalContainer: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
