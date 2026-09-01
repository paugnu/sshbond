import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';
import { SessionManager } from '../../features/terminal/SessionManager';
import { SSHSessionInfo } from '@/domain/models/sshConfig';
import { Terminal, ArrowRight, XCircle } from 'lucide-react-native';

export default function SessionsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [sessions, setSessions] = useState<SSHSessionInfo[]>([]);

  const loadSessions = useCallback(() => {
    setSessions(SessionManager.getSessions());
  }, []);

  useEffect(() => {
    loadSessions();
    return SessionManager.subscribe(loadSessions);
  }, [loadSessions]);

  const handleOpenTerminal = (sessionId: string) => {
    router.push(`/terminal/${sessionId}`);
  };

  const handleCloseSession = async (sessionId: string) => {
    await SessionManager.closeSession(sessionId);
    loadSessions();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSubtle }]}>
              <Terminal size={32} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Active Sessions</Text>
            <Text style={[styles.emptyDesc, { color: colors.textMuted }]}>
              Connect to any host from the Hosts tab to start an interactive SSH session. You can switch between sessions freely without losing connection state.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {sessions.map(session => {
              const isConnected = session.status === 'connected';
              const isError = session.status === 'error';
              const dotColor = isConnected ? colors.success : isError ? colors.error : colors.warning;

              return (
                <TouchableOpacity
                  key={session.id}
                  style={[styles.sessionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => handleOpenTerminal(session.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.left}>
                    <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                    <View style={styles.info}>
                      <Text style={[styles.alias, { color: colors.text }]}>{session.hostAlias}</Text>
                      <Text style={[styles.details, { color: colors.textMuted }]}>
                        {session.username ? `${session.username}@` : ''}{session.hostname}:{session.port}
                      </Text>
                      <Text style={[styles.statusText, { color: dotColor }]}>
                        ● {session.status.toUpperCase()}
                      </Text>
                      {SessionManager.getTunnels(session.id).map(tunnel => (
                        <Text
                          key={tunnel.id}
                          style={[
                            styles.tunnelText,
                            { color: tunnel.status === 'error' ? colors.error : colors.textSubtle },
                          ]}
                        >
                          {tunnel.description}
                          {tunnel.status === 'active'
                            ? ''
                            : ` (${tunnel.status}${tunnel.message ? `: ${tunnel.message}` : ''})`}
                        </Text>
                      ))}
                    </View>
                  </View>

                  <View style={styles.right}>
                    <TouchableOpacity
                      style={[styles.closeBtn, { borderColor: colors.border }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleCloseSession(session.id);
                      }}
                    >
                      <XCircle size={16} color={colors.error} />
                    </TouchableOpacity>
                    <ArrowRight size={18} color={colors.textSubtle} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  list: {
    gap: 10,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  info: {
    flex: 1,
  },
  alias: {
    fontSize: 15,
    fontWeight: '700',
  },
  details: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  tunnelText: {
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
