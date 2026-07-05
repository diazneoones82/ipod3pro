import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, currentTrack } from '@/src/state/PlayerContext';

export default function FolderDetail() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path: string }>();
  const router = useRouter();
  const player = usePlayer();

  const folderPath = decodeURIComponent(params.path || '');
  const folder = useMemo(() => player.folders.find((f) => f.path === folderPath), [player.folders, folderPath]);
  const playing = currentTrack(player);

  const onTrackPress = (idx: number) => {
    if (!folder) return;
    player.playFolder(folder.path, idx);
    router.push('/(tabs)');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable testID="folder-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{folder?.name ?? 'Folder'}</Text>
          <Text style={styles.subtitle}>{folder?.trackCount ?? 0} tracks</Text>
        </View>
        {folder && folder.trackCount > 0 && (
          <Pressable
            testID="play-all"
            onPress={() => onTrackPress(0)}
            style={styles.playAll}
          >
            <Ionicons name="play" size={14} color={COLORS.onBrandPrimary} />
            <Text style={styles.playAllText}>Play all</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={folder?.tracks ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
        renderItem={({ item, index }) => {
          const isPlaying = playing?.id === item.id;
          return (
            <Pressable testID={`track-row-${index}`} onPress={() => onTrackPress(index)} style={styles.row}>
              <View style={[styles.idx, isPlaying && { backgroundColor: COLORS.brandTertiary }]}>
                {isPlaying ? (
                  <Ionicons name="musical-notes" size={14} color={COLORS.brand} />
                ) : (
                  <Text style={styles.idxText}>{index + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.trackName, isPlaying && { color: COLORS.brand }]} numberOfLines={1}>
                  {item.filename.replace(/\.[^.]+$/, '')}
                </Text>
                <Text style={styles.trackMeta}>{item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '—'}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md, gap: SPACING.sm },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  title: { color: COLORS.onSurface, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  playAll: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill },
  playAllText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  idx: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  idxText: { color: COLORS.onSurfaceTertiary, fontSize: 12, fontWeight: '600' },
  trackName: { color: COLORS.onSurface, fontSize: 14, fontWeight: '600' },
  trackMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
});
