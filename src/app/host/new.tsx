import React from 'react';
import { useRouter } from 'expo-router';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHHost } from '@/domain/models/sshConfig';
import { HostEditor } from '../../features/hosts/HostEditor';

export default function NewHostScreen() {
  const router = useRouter();

  const handleSave = async (newHost: SSHHost) => {
    await HostStorageService.saveHost(newHost);
    router.back();
  };

  return (
    <HostEditor
      onSave={handleSave}
      onCancel={() => router.back()}
    />
  );
}
