import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';
import { SSHHost, SSHGroup } from '@/domain/models/sshConfig';
import { HostStorageService } from '../../services/persistence/HostStorageService';
import { SSHConfigResolver } from '../../services/ssh/config/SSHConfigResolver';
import { SessionManager } from '../../features/terminal/SessionManager';
import { HostCard } from '../../features/hosts/HostCard';
import { QuickConnectBar } from '../../features/hosts/QuickConnectBar';
import { GroupHeader } from '../../features/hosts/GroupHeader';
import { useConnectionPrompts } from '../../features/connect/useConnectionPrompts';
import { parseConnectionString } from '../../utils/connectionString';
import { Search, Plus, Server, Terminal, Copy, Edit, Trash2, ArrowUpRight } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

export default function HostsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { connectOptions, prompts } = useConnectionPrompts();

  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [groups, setGroups] = useState<SSHGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedHostForMenu, setSelectedHostForMenu] = useState<SSHHost | null>(null);

  const loadData = async () => {
    const loadedHosts = await HostStorageService.getHosts();
    const loadedGroups = await HostStorageService.getGroups();
    setHosts(loadedHosts);
    setGroups(loadedGroups);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const handleConnect = async (host: SSHHost) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const resolved = SSHConfigResolver.resolveFromHostModels(host, hosts);
      const { session } = await SessionManager.createSession(resolved, {
        ...connectOptions,
        hostId: host.id.startsWith('temp_') ? undefined : host.id,
      });
      router.push(`/terminal/${session.id}`);
    } catch (err: any) {
      Alert.alert('Connection Failed', err?.message || 'Unable to establish SSH session.');
    }
  };

  const handleQuickConnect = async (connStr: string) => {
    try {
      const { username, hostname, port } = parseConnectionString(connStr);

      await handleConnect({
        id: `temp_${Date.now()}`,
        alias: hostname,
        hostname,
        port,
        username,
        tags: [],
        favorite: false,
        authenticationType: 'password',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      Alert.alert('Quick Connect Error', err?.message || 'Failed to connect.');
    }
  };

  const handleQuickSave = async (connStr: string) => {
    try {
      const { username, hostname, port } = parseConnectionString(connStr);

      await HostStorageService.saveHost({
        id: `host_${Date.now()}`,
        alias: hostname,
        hostname,
        port,
        username,
        tags: [],
        favorite: false,
        // Without a key selected yet, password auth is the only thing that can
        // actually succeed; the host editor can switch it to a key later.
        authenticationType: 'password',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await loadData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Quick Save Error', err?.message || 'Could not save this host.');
    }
  };

  const handleToggleFavorite = async (host: SSHHost) => {
    const updated = { ...host, favorite: !host.favorite };
    await HostStorageService.saveHost(updated);
    await loadData();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleOpenContextMenu = (host: SSHHost) => {
    setSelectedHostForMenu(host);
  };

  const handleCopySSHCommand = async (host: SSHHost) => {
    const cmd = `ssh -p ${host.port || 22} ${host.username ? `${host.username}@` : ''}${host.hostname || host.alias}`;
    await Clipboard.setStringAsync(cmd);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedHostForMenu(null);
  };

  const handleDuplicate = async (host: SSHHost) => {
    const dup: SSHHost = {
      ...host,
      id: `host_${Date.now()}_dup`,
      alias: `${host.alias}-copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await HostStorageService.saveHost(dup);
    await loadData();
    setSelectedHostForMenu(null);
  };

  const handleDeleteHost = async (host: SSHHost) => {
    Alert.alert('Delete Host', `Are you sure you want to remove "${host.alias}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await HostStorageService.deleteHost(host.id);
          await loadData();
          setSelectedHostForMenu(null);
        },
      },
    ]);
  };

  // Filter hosts
  const filteredHosts = hosts.filter(h => {
    const matchSearch =
      !searchQuery ||
      h.alias.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchGroup = !selectedGroup || h.groupId === selectedGroup;
    return matchSearch && matchGroup;
  });

  const favorites = filteredHosts.filter(h => h.favorite);
  const groupedHostsMap = new Map<string, SSHHost[]>();

  // Collect grouped hosts
  for (const group of groups) {
    const inGroup = filteredHosts.filter(h => h.groupId === group.id && !h.favorite);
    if (inGroup.length > 0) {
      groupedHostsMap.set(group.name, inGroup);
    }
  }

  const ungrouped = filteredHosts.filter(h => !h.groupId && !h.favorite);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Quick Connect Bar */}
        <QuickConnectBar onConnect={handleQuickConnect} onSave={handleQuickSave} />

        {/* Search Bar */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search hosts, IPs, users, tags..."
            placeholderTextColor={colors.textSubtle}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Group Filter Pills */}
        {groups.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll}>
            <TouchableOpacity
              style={[
                styles.pill,
                {
                  backgroundColor: selectedGroup === null ? colors.primary : colors.surfaceSubtle,
                  borderColor: selectedGroup === null ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedGroup(null)}
            >
              <Text style={[styles.pillText, { color: selectedGroup === null ? '#ffffff' : colors.text }]}>
                All ({hosts.length})
              </Text>
            </TouchableOpacity>

            {groups.map(g => {
              const count = hosts.filter(h => h.groupId === g.id).length;
              const isSelected = selectedGroup === g.id;
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedGroup(isSelected ? null : g.id)}
                >
                  <Text style={[styles.pillText, { color: isSelected ? '#ffffff' : colors.text }]}>
                    {g.name} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <View>
            <GroupHeader title="Favorites" count={favorites.length} />
            {favorites.map(h => (
              <HostCard
                key={h.id}
                host={h}
                onPress={() => handleConnect(h)}
                onLongPress={() => handleOpenContextMenu(h)}
                onToggleFavorite={() => handleToggleFavorite(h)}
                onEdit={() => router.push(`/host/${h.id}`)}
                onDelete={() => handleDeleteHost(h)}
              />
            ))}
          </View>
        )}

        {/* Grouped sections */}
        {Array.from(groupedHostsMap.entries()).map(([groupName, gHosts]) => (
          <View key={groupName}>
            <GroupHeader title={groupName} count={gHosts.length} />
            {gHosts.map(h => (
              <HostCard
                key={h.id}
                host={h}
                onPress={() => handleConnect(h)}
                onLongPress={() => handleOpenContextMenu(h)}
                onToggleFavorite={() => handleToggleFavorite(h)}
                onEdit={() => router.push(`/host/${h.id}`)}
                onDelete={() => handleDeleteHost(h)}
              />
            ))}
          </View>
        ))}

        {/* Ungrouped */}
        {ungrouped.length > 0 && (
          <View>
            <GroupHeader title={favorites.length > 0 || groupedHostsMap.size > 0 ? 'Other Hosts' : 'All Hosts'} count={ungrouped.length} />
            {ungrouped.map(h => (
              <HostCard
                key={h.id}
                host={h}
                onPress={() => handleConnect(h)}
                onLongPress={() => handleOpenContextMenu(h)}
                onToggleFavorite={() => handleToggleFavorite(h)}
                onEdit={() => router.push(`/host/${h.id}`)}
                onDelete={() => handleDeleteHost(h)}
              />
            ))}
          </View>
        )}

        {/* Empty State */}
        {hosts.length === 0 && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSubtle }]}>
              <Server size={32} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Saved Hosts</Text>
            <Text style={[styles.emptyDesc, { color: colors.textMuted }]}>
              Tap the &quot;+ Add Host&quot; button or use the Quick Connect bar above to connect to your SSH servers.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/host/new')}
        activeOpacity={0.8}
      >
        <Plus size={20} color="#ffffff" />
        <Text style={styles.fabText}>Add Host</Text>
      </TouchableOpacity>

      {/* Context Action Menu Modal */}
      {selectedHostForMenu && (
        <Modal visible transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setSelectedHostForMenu(null)}
          >
            <View style={[styles.actionSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>{selectedHostForMenu.alias}</Text>
                <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>
                  {selectedHostForMenu.username ? `${selectedHostForMenu.username}@` : ''}
                  {selectedHostForMenu.hostname}:{selectedHostForMenu.port || 22}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => {
                  const h = selectedHostForMenu;
                  setSelectedHostForMenu(null);
                  handleConnect(h);
                }}
              >
                <Terminal size={18} color={colors.primary} />
                <Text style={[styles.sheetItemText, { color: colors.text }]}>Connect Terminal</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => {
                  const id = selectedHostForMenu.id;
                  setSelectedHostForMenu(null);
                  router.push(`/host/${id}`);
                }}
              >
                <Edit size={18} color={colors.text} />
                <Text style={[styles.sheetItemText, { color: colors.text }]}>Edit Configuration</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => handleCopySSHCommand(selectedHostForMenu)}
              >
                <Copy size={18} color={colors.text} />
                <Text style={[styles.sheetItemText, { color: colors.text }]}>Copy SSH Command</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => handleDuplicate(selectedHostForMenu)}
              >
                <ArrowUpRight size={18} color={colors.text} />
                <Text style={[styles.sheetItemText, { color: colors.text }]}>Duplicate Host</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: colors.borderSubtle }]}
                onPress={() => handleDeleteHost(selectedHostForMenu)}
              >
                <Trash2 size={18} color={colors.error} />
                <Text style={[styles.sheetItemText, { color: colors.error }]}>Delete Host</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {prompts}
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
    paddingBottom: 80,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  pillsScroll: {
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
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
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 24,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 32,
  },
  sheetHeader: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  sheetItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
