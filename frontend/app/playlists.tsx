import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert, TextInput, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, type Track } from '@/src/state/PlayerContext';

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await player.addTrackToPlaylist('', undefined, newName.trim());
    setNewName('');
    setCreateOpen(false);
  }, [newName, player]);

  const handleDelete = useCallback((playlistId: string, name: string) => {
    Alert.alert('Delete', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          const updated = player.savedPlaylists.filter((p) => p.id !== playlistId);
          player.setSavedPlaylists(updated);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
      },
    ]);
  }, [player]);

  const handleImport = useCallback(async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await FileSystem.readAsStringAsync(res.assets[0].uri);
      const lines = text.split('\n').filter(Boolean);
      if (lines.length === 0) return;
      const name = res.assets[0].name?.replace(/\.[^.]+$/, '') || 'Imported';
      for (const trackId of lines) {
        await player.addTrackToPlaylist(trackId.trim(), undefined, name);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Imported', `Playlist "${name}" imported with ${lines.length} tracks.`);
    } catch {
      Alert.alert('Error', 'Could not import playlist file.');
    }
  }, [player]);

  const handleExport = useCallback(async (playlistId: string, name: string) => {
    const playlist = player.savedPlaylists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const allTracks: Track[] = [];
    for (const f of player.folders) {
      for (const t of f.tracks) {
        if (playlist.trackIds.includes(t.id)) allTracks.push(t);
      }
    }
    const lines = allTracks.map((t) => t.uri).join('\n');
    const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!dir) return;
    const path = `${dir}${name.replace(/[^a-z0-9_-]/gi, '_')}.m3u`;
    await FileSystem.writeAsStringAsync(path, lines);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: `Export ${name}` });
        return;
      }
    } catch {}
    Alert.alert('Exported', `Playlist saved to ${path}`);
  }, [player.folders, player.savedPlaylists]);

  const handlePlay = useCallback((playlistId: string) => {
    const playlist = player.savedPlaylists.find((p) => p.id === playlistId);
    if (!playlist || playlist.trackIds.length === 0) return;
    const allTracks: Track[] = [];
    for (const f of player.folders) {
      for (const t of f.tracks) {
        if (playlist.trackIds.includes(t.id)) allTracks.push(t);
      }
    }
    if (allTracks.length > 0) {
      player.playTrack(allTracks[0]);
    }
  }, [player]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Playlists</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={handleImport} hitSlop={8} style={styles.headerBtn}>
            <Ionicons name="download-outline" size={18} color={COLORS.onSurface} />
          </Pressable>
          <Pressable onPress={() => setCreateOpen(true)} hitSlop={8} style={styles.headerBtn}>
            <Ionicons name="add" size={22} color={COLORS.onSurface} />
          </Pressable>
        </View>
      </View>
      <FlatList
        data={player.savedPlaylists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={48} color={COLORS.onSurfaceTertiary} />
            <Text style={styles.emptyText}>No playlists yet</Text>
            <Text style={styles.emptySubtext}>Tap + to create one</Text>
          </View>
        }
        renderItem={({ item }) => {
          const trackCount = item.trackIds.filter((id) =>
            player.folders.some((f) => f.tracks.some((t) => t.id === id)),
          ).length;
          return (
            <Pressable
              style={styles.playlistRow}
              onPress={() => handlePlay(item.id)}
            >
              <View style={styles.playlistIcon}>
                <Ionicons name="list" size={22} color={COLORS.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.playlistMeta}>{trackCount} tracks</Text>
              </View>
              <Pressable onPress={() => handleExport(item.id, item.name)} hitSlop={8} style={styles.rowBtn}>
                <Ionicons name="share-outline" size={16} color={COLORS.onSurfaceSecondary} />
              </Pressable>
              <Pressable onPress={() => handleDelete(item.id, item.name)} hitSlop={8} style={styles.rowBtn}>
                <Ionicons name="trash-outline" size={16} color={COLORS.error} />
              </Pressable>
            </Pressable>
          );
        }}
      />
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.createDialog}>
            <Text style={styles.createTitle}>New Playlist</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Playlist name"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.createInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleCreate} disabled={!newName.trim()} style={[styles.createBtn, !newName.trim() && styles.btnDisabled]}>
                <Text style={styles.createText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  title: { color: COLORS.onSurface, fontSize: 18, fontWeight: '800', flex: 1, textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  listContent: { paddingHorizontal: SPACING.lg, paddingBottom: 40 },
  playlistRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  playlistIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(0,245,255,0.10)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,245,255,0.18)' },
  playlistName: { color: COLORS.onSurface, fontSize: 15, fontWeight: '700' },
  playlistMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  rowBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { color: COLORS.onSurfaceTertiary, fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: COLORS.onSurfaceTertiary, fontSize: 12 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)', padding: SPACING.lg },
  createDialog: { width: '100%', maxWidth: 360, borderRadius: RADIUS.lg, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  createTitle: { color: COLORS.onSurface, fontSize: 18, fontWeight: '800', marginBottom: SPACING.md },
  createInput: { color: COLORS.onSurface, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: SPACING.md },
  dialogActions: { flexDirection: 'row', gap: SPACING.sm },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, paddingVertical: 11, backgroundColor: 'rgba(255,255,255,0.06)' },
  cancelText: { color: COLORS.onSurface, fontWeight: '600', fontSize: 13 },
  createBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, paddingVertical: 11, backgroundColor: COLORS.brand },
  createText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});
