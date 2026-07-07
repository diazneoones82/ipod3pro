import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, type Track } from '@/src/state/PlayerContext';
import { readNativeAudioTags, writeNativeAudioTags, type NativeAudioTags } from '@/src/native/ShuffleEqualizer';

type EditableFields = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  trackNumber: string;
  composer: string;
  lyrics: string;
};

const FIELD_LABELS: Record<keyof EditableFields, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  genre: 'Genre',
  year: 'Year',
  trackNumber: 'Track #',
  composer: 'Composer',
  lyrics: 'Lyrics',
};

export default function TagEditorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const params = useLocalSearchParams<{ trackId?: string; fromQueue?: string }>();

  const track: Track | null = React.useMemo(() => {
    if (params.trackId) {
      for (const f of player.folders) {
        const found = f.tracks.find((t) => t.id === params.trackId);
        if (found) return found;
      }
    }
    return player.queue[player.currentIndex] ?? null;
  }, [params.trackId, player.folders, player.queue, player.currentIndex]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [fields, setFields] = useState<EditableFields>({
    title: '', artist: '', album: '', albumArtist: '',
    genre: '', year: '', trackNumber: '', composer: '', lyrics: '',
  });
  const [nativeTags, setNativeTags] = useState<NativeAudioTags | null>(null);

  useEffect(() => {
    if (!track) return;
    (async () => {
      setLoading(true);
      try {
        const tags = await readNativeAudioTags(track.uri);
        if (tags) {
          setNativeTags(tags);
          setFields({
            title: tags.title ?? track.title ?? '',
            artist: tags.artist ?? track.artist ?? '',
            album: tags.album ?? track.album ?? '',
            albumArtist: tags.albumArtist ?? '',
            genre: tags.genre ?? '',
            year: tags.year ?? '',
            trackNumber: tags.trackNumber ?? '',
            composer: tags.composer ?? '',
            lyrics: tags.lyrics ?? '',
          });
        } else {
          setFields({
            title: track.title ?? '',
            artist: track.artist ?? '',
            album: track.album ?? '',
            albumArtist: '',
            genre: '',
            year: '',
            trackNumber: '',
            composer: '',
            lyrics: '',
          });
        }
      } catch {
        setFields({
          title: track.title ?? '',
          artist: track.artist ?? '',
          album: track.album ?? '',
          albumArtist: '',
          genre: '',
          year: '',
          trackNumber: '',
          composer: '',
          lyrics: '',
        });
      }
      setLoading(false);
    })();
  }, [track]);

  const updateField = useCallback((key: keyof EditableFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setChanged(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!track || saving) return;
    if (!changed) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      const tagsToWrite: Record<string, string> = {};
      for (const key of Object.keys(FIELD_LABELS) as (keyof EditableFields)[]) {
        if (fields[key].trim()) tagsToWrite[key] = fields[key].trim();
      }
      const ok = await writeNativeAudioTags(track.uri, tagsToWrite);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Saved', 'Tags updated successfully.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        Alert.alert('Error', 'Could not write tags to this file.');
      }
    } catch {
      Alert.alert('Error', 'An unexpected error occurred while saving tags.');
    }
    setSaving(false);
  }, [track, saving, changed, fields, router]);

  const renderField = (key: keyof EditableFields) => (
    <View key={key} style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{FIELD_LABELS[key]}</Text>
      <TextInput
        style={[styles.fieldInput, key === 'lyrics' && styles.fieldInputMultiline]}
        value={fields[key]}
        onChangeText={(v) => updateField(key, v)}
        placeholderTextColor={COLORS.onSurfaceTertiary}
        placeholder={`Enter ${FIELD_LABELS[key].toLowerCase()}`}
        multiline={key === 'lyrics'}
        numberOfLines={key === 'lyrics' ? 4 : 1}
        autoCapitalize={key === 'lyrics' ? 'sentences' : 'sentences'}
      />
    </View>
  );

  if (!track) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
          </Pressable>
          <Text style={styles.title}>Tag Editor</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="pricetag-outline" size={48} color={COLORS.onSurfaceTertiary} />
          <Text style={styles.emptyText}>No track selected</Text>
          <Text style={styles.emptySubtext}>Play a track to edit its metadata</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
          </Pressable>
          <Text style={styles.title}>Tag Editor</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <ActivityIndicator color={COLORS.brand} />
          <Text style={styles.emptyText}>Reading tags...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Tag Editor</Text>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          hitSlop={8}
          style={[styles.saveBtn, !changed && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.onBrandPrimary} />
          ) : (
            <Text style={[styles.saveText, !changed && styles.saveTextDisabled]}>Save</Text>
          )}
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.trackInfo}>
            <View style={styles.trackThumb}>
              {track.artworkUri ? (
                <Image source={{ uri: track.artworkUri }} style={styles.trackThumbImg} contentFit="cover" />
              ) : (
                <Ionicons name="musical-note" size={24} color={COLORS.onSurfaceTertiary} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.trackFilename} numberOfLines={1}>{track.filename}</Text>
              <Text style={styles.trackFolder} numberOfLines={1}>{track.folder}</Text>
            </View>
          </View>
          {Object.keys(FIELD_LABELS).filter((k) => k !== 'lyrics').map((key) => renderField(key as keyof EditableFields))}
          <View style={styles.sectionDivider}>
            <Text style={styles.sectionTitle}>Additional</Text>
          </View>
          {renderField('lyrics')}
        </ScrollView>
      </KeyboardAvoidingView>
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
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  saveBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  saveText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '800' },
  saveTextDisabled: { color: COLORS.onSurfaceTertiary },
  scrollContent: { padding: SPACING.lg, paddingBottom: 60 },
  trackInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: SPACING.lg,
  },
  trackThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  trackThumbImg: { width: 48, height: 48, borderRadius: 8 },
  trackFilename: { color: COLORS.onSurface, fontSize: 14, fontWeight: '700' },
  trackFolder: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  fieldGroup: { marginBottom: SPACING.md },
  fieldLabel: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  fieldInput: {
    color: COLORS.onSurface, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  fieldInputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  sectionDivider: { marginTop: SPACING.sm, marginBottom: SPACING.md, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: SPACING.md },
  sectionTitle: { color: COLORS.onSurfaceTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: COLORS.onSurfaceTertiary, fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: COLORS.onSurfaceTertiary, fontSize: 12 },
});
