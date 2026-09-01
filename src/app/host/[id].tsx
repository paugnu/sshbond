import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHHost } from '@/domain/models/sshConfig';
import { HostEditor } from '../../features/hosts/HostEditor';
import { useTheme } from '../../theme/ThemeContext';

export default function EditHostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();

  const [host, setHost] = useState<SSHHost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      HostStorageService.getHostById(id).then(h => {
        if (h) setHost(h);
        setLoading(false);
      });
    }
  }, [id]);

  const handleSave = async (updatedHost: SSHHost) => {
    await HostStorageService.saveHost(updatedHost);
    router.back();
  };

  const handleDelete = async (hostId: string) => {
    await HostStorageService.deleteHost(hostId);
    router.back();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <HostEditor
      initialHost={host || undefined}
      onSave={handleSave}
      onDelete={handleDelete}
      onCancel={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
