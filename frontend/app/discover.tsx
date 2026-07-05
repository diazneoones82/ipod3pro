import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, FlatList, ActivityIndicator, TextInput, Dimensions, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import GlassCard from '@/src/components/GlassCard';
import FrequencyGraph from '@/src/components/FrequencyGraph';
import { listProfiles, toggleStar, profileConfigUrl, publishProfile, type RemoteEQProfile } from '@/src/utils/api';
import { listPeqAutoEqProfiles, type PeqAutoEqProfile } from '@/src/utils/peq-autoeq';
import { listAutoEqProfiles, resolveAutoEqParametricConfig, type AutoEqProfile } from '@/src/utils/autoeq';
import { useEQ } from '@/src/state/EQContext';
import { createBand, parseEqualizerApo, parsePeqAutoEq, serializeEqualizerApo, peqAutoEqToEqualizerApo, type EQConfig, type FilterType } from '@/src/utils/eq-parser';

type SortKey = 'trending' | 'new' | 'stars';
type SourceKey = 'peq' | 'autoeq' | 'community' | 'local';

type LocalPeqProfile = {
  id: string;
  name: string;
  kind: 'PEQ' | 'TXT';
  uri: string;
};

const LOCAL_PEQ_FOLDER_KEY = '@shuffleimusic/local_peq_folder_uri';

function hasUsableEqConfig(config: EQConfig): boolean {
  return config.bands.length > 0 || Math.abs(config.preamp) > 0.001;
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const eq = useEQ();
  const [profiles, setProfiles] = useState<RemoteEQProfile[]>([]);
  const [peqProfiles, setPeqProfiles] = useState<PeqAutoEqProfile[]>([]);
  const [autoEqProfiles, setAutoEqProfiles] = useState<AutoEqProfile[]>([]);
  const [localProfiles, setLocalProfiles] = useState<LocalPeqProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceKey>('peq');
  const [sort, setSort] = useState<SortKey>('trending');
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<RemoteEQProfile | null>(null);
  const [selectedPeq, setSelectedPeq] = useState<PeqAutoEqProfile | null>(null);
  const [selectedAutoEq, setSelectedAutoEq] = useState<AutoEqProfile | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<LocalPeqProfile | null>(null);
  const [localFolderUri, setLocalFolderUri] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishAuthor, setPublishAuthor] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishing, setPublishing] = useState(false);

  const screenWidth = Dimensions.get('window').width;

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (source === 'peq') {
        if (peqProfiles.length === 0) {
          const list = await listPeqAutoEqProfiles();
          setPeqProfiles(list);
        }
      } else if (source === 'autoeq') {
        if (autoEqProfiles.length === 0) {
          const list = await listAutoEqProfiles();
          setAutoEqProfiles(list);
        }
      } else if (source === 'local') {
        // Local profiles are populated by the Android folder picker.
      } else {
        const list = await listProfiles({ sort, q: q.trim() || undefined });
        setProfiles(list);
      }
    } catch (e) {
      showToast('Could not load profiles');
    }
    setLoading(false);
  }, [source, sort, q, peqProfiles.length, autoEqProfiles.length]);

  useEffect(() => { load(); }, [load]);

  const filteredPeqProfiles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? peqProfiles.filter((p) => `${p.name} ${p.source} ${p.kind}`.toLowerCase().includes(needle))
      : peqProfiles;
    return list.slice(0, 120);
  }, [peqProfiles, q]);

  const filteredAutoEqProfiles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? autoEqProfiles.filter((p) => `${p.name} ${p.source} ${p.measurement}`.toLowerCase().includes(needle))
      : autoEqProfiles;
    return list.slice(0, 120);
  }, [autoEqProfiles, q]);

  const filteredLocalProfiles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? localProfiles.filter((p) => `${p.name} ${p.kind}`.toLowerCase().includes(needle))
      : localProfiles;
  }, [localProfiles, q]);

  const collectLocalPeqFiles = useCallback(async (rootUri: string) => {
    const found: LocalPeqProfile[] = [];
    const seen = new Set<string>();
    const walk = async (dirUri: string, depth: number) => {
      if (depth > 5) return;
      let entries: string[] = [];
      try {
        entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);
      } catch {
        return;
      }
      for (const uri of entries) {
        const decoded = decodeURIComponent(uri);
        const name = decoded.split('/').pop()?.replace(/^document:/, '') || decoded;
        if (/\.(peq|txt)$/i.test(name)) {
          if (seen.has(uri)) continue;
          seen.add(uri);
          found.push({
            id: uri,
            uri,
            name: name.replace(/\.(peq|txt)$/i, ''),
            kind: /\.peq$/i.test(name) ? 'PEQ' : 'TXT',
          });
          continue;
        }
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
          await walk(uri, depth + 1);
        }
      }
    };
    await walk(rootUri, 0);
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const loadLocalPeqFolder = useCallback(async (folderUri: string, silent = false) => {
    try {
      setLoading(true);
      const files = await collectLocalPeqFiles(folderUri);
      setLocalProfiles(files);
      setLocalFolderUri(folderUri);
      setSource('local');
      if (!silent) showToast(files.length ? `Loaded ${files.length} local presets` : 'No .peq or .txt files found');
      return files.length;
    } catch {
      if (!silent) showToast('Saved PEQ folder is unavailable');
      return 0;
    } finally {
      setLoading(false);
    }
  }, [collectLocalPeqFiles]);

  useEffect(() => {
    AsyncStorage.getItem(LOCAL_PEQ_FOLDER_KEY)
      .then((uri) => {
        if (uri) {
          setLocalFolderUri(uri);
          loadLocalPeqFolder(uri, true);
        }
      })
      .catch(() => {});
  }, [loadLocalPeqFolder]);

  const pickLocalPeqFolder = useCallback(async () => {
    try {
      setLoading(true);
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;
      await AsyncStorage.setItem(LOCAL_PEQ_FOLDER_KEY, permissions.directoryUri);
      await loadLocalPeqFolder(permissions.directoryUri);
    } catch {
      showToast('Folder import failed');
    } finally {
      setLoading(false);
    }
  }, [loadLocalPeqFolder]);

  const openLocalImport = useCallback(() => {
    setSource('local');
    if (localProfiles.length > 0) return;
    if (localFolderUri) {
      loadLocalPeqFolder(localFolderUri);
      return;
    }
    pickLocalPeqFolder();
  }, [loadLocalPeqFolder, localFolderUri, localProfiles.length, pickLocalPeqFolder]);

  const handleStar = useCallback(async (p: RemoteEQProfile) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // optimistic
    setProfiles((arr) => arr.map((x) => x.id === p.id ? { ...x, starred: !x.starred, stars: x.stars + (x.starred ? -1 : 1) } : x));
    if (selected?.id === p.id) {
      setSelected((s) => s ? { ...s, starred: !s.starred, stars: s.stars + (s.starred ? -1 : 1) } : s);
    }
    try {
      const res = await toggleStar(p.id);
      setProfiles((arr) => arr.map((x) => x.id === p.id ? { ...x, starred: res.starred, stars: res.stars } : x));
    } catch {
      // revert
      setProfiles((arr) => arr.map((x) => x.id === p.id ? p : x));
      showToast('Star failed');
    }
  }, [selected]);

  const applyToEQ = useCallback((p: RemoteEQProfile) => {
    eq.setPreamp(p.preamp);
    // Re-create bands to ensure fresh ids
    const bands = p.bands.map((b) => createBand({
      enabled: b.enabled, type: b.type as FilterType, freq: b.freq, gain: b.gain, q: b.q,
    }));
    // import via the importConfig path so selectedPreset is cleared
    const text = [`Preamp: ${p.preamp.toFixed(1)} dB`,
      ...bands.map((b, i) => `Filter ${i + 1}: ${b.enabled ? 'ON' : 'OFF'} ${b.type} Fc ${b.freq.toFixed(0)} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.q.toFixed(3)}`)
    ].join('\n');
    eq.importConfig(text, p.name);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSelected(null);
    showToast(`Applied "${p.name}"`);
    setTimeout(() => router.back(), 600);
  }, [eq, router]);

  const applyPeqToEQ = useCallback(async (p: PeqAutoEqProfile) => {
    try {
      const res = await fetch(p.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const ok = eq.importConfig(peqAutoEqToEqualizerApo(text), p.name);
      if (!ok) throw new Error('Invalid PEQ');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSelectedPeq(null);
      showToast(`Applied "${p.name}"`);
      setTimeout(() => router.back(), 600);
    } catch {
      showToast('PEQ import failed');
    }
  }, [eq, router]);

  const applyAutoEqToEQ = useCallback(async (p: AutoEqProfile) => {
    try {
      const text = await resolveAutoEqParametricConfig(p);
      const ok = eq.importConfig(text, p.name);
      if (!ok) throw new Error('Invalid AutoEq config');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSelectedAutoEq(null);
      showToast(`Applied "${p.name}"`);
      setTimeout(() => router.back(), 600);
    } catch {
      showToast('AutoEq import failed');
    }
  }, [eq, router]);

  const applyLocalToEQ = useCallback(async (p: LocalPeqProfile) => {
    try {
      const text = await FileSystem.StorageAccessFramework.readAsStringAsync(p.uri);
      const trimmed = text.trim();
      const errors: string[] = [];
      let imported = false;

      const tryImport = (config: EQConfig) => {
        if (!hasUsableEqConfig(config)) throw new Error('No usable EQ bands');
        const ok = eq.importConfig(serializeEqualizerApo(config), p.name);
        if (!ok) throw new Error('EQ import rejected');
        imported = true;
      };

      if (p.kind === 'PEQ' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          tryImport(parsePeqAutoEq(text));
        } catch (e) {
          errors.push(e instanceof Error ? e.message : 'PEQ parse failed');
        }
      }

      if (!imported) {
        try {
          tryImport(parseEqualizerApo(text));
        } catch (e) {
          errors.push(e instanceof Error ? e.message : 'APO parse failed');
        }
      }

      if (!imported) throw new Error(errors[0] || 'Invalid local PEQ');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSelectedLocal(null);
      showToast(`Applied "${p.name}"`);
      setTimeout(() => router.back(), 600);
    } catch {
      showToast('Local import failed');
    }
  }, [eq, router]);

  const shareConfig = useCallback(async (p: RemoteEQProfile) => {
    try {
      const url = profileConfigUrl(p.id);
      const res = await fetch(url);
      const text = await res.text();
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) { showToast('Storage unavailable'); return; }
      const path = `${dir}${p.name.replace(/[^a-z0-9]+/gi, '_')}.txt`;
      await FileSystem.writeAsStringAsync(path, text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: `Share "${p.name}"` });
      } else {
        showToast(`Saved to ${path}`);
      }
    } catch {
      showToast('Share failed');
    }
  }, []);

  const handlePublish = useCallback(async () => {
    if (!publishName.trim() || !publishAuthor.trim()) {
      showToast('Name & author required');
      return;
    }
    setPublishing(true);
    try {
      const stripped = eq.bands.map((b) => ({
        enabled: b.enabled, type: b.type, freq: b.freq, gain: b.gain, q: b.q,
      }));
      const created = await publishProfile({
        name: publishName.trim(),
        author: publishAuthor.trim(),
        description: publishDesc.trim(),
        tags: [],
        preamp: eq.preamp,
        bands: stripped,
      });
      setProfiles((arr) => [created, ...arr]);
      setPublishOpen(false);
      setPublishName(''); setPublishAuthor(''); setPublishDesc('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast('Published! Share your config 🎧');
    } catch (e) {
      showToast('Publish failed');
    }
    setPublishing(false);
  }, [publishName, publishAuthor, publishDesc, eq.bands, eq.preamp]);

  const sorts: { k: SortKey; label: string; icon: any }[] = [
    { k: 'trending', label: 'Trending', icon: 'flame' },
    { k: 'new', label: 'New', icon: 'sparkles' },
    { k: 'stars', label: 'Top', icon: 'star' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient colors={['rgba(245,158,11,0.10)', 'transparent']} style={[StyleSheet.absoluteFill, { height: 260 }]} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="discover-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.subtitle}>Audiophile-curated EQ profiles</Text>
        </View>
        {source === 'community' && (
          <Pressable onPress={() => setPublishOpen(true)} testID="publish-btn" style={styles.publishBtn}>
            <Ionicons name="cloud-upload" size={14} color={COLORS.onBrandPrimary} />
            <Text style={styles.publishBtnText}>Publish</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.sourceRow}>
        <Pressable
          testID="source-peq"
          onPress={() => setSource('peq')}
          style={[styles.sourceChip, source === 'peq' && styles.sourceChipActive]}
        >
          <Ionicons name="headset" size={13} color={source === 'peq' ? COLORS.brand : COLORS.onSurfaceSecondary} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sourceText, source === 'peq' && styles.sourceTextActive]}>PEQ</Text>
        </Pressable>
        <Pressable
          testID="source-autoeq"
          onPress={() => setSource('autoeq')}
          style={[styles.sourceChip, source === 'autoeq' && styles.sourceChipActive]}
        >
          <Ionicons name="analytics" size={13} color={source === 'autoeq' ? COLORS.brand : COLORS.onSurfaceSecondary} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sourceText, source === 'autoeq' && styles.sourceTextActive]}>AutoEq</Text>
        </Pressable>
        <Pressable
          testID="source-community"
          onPress={() => setSource('community')}
          style={[styles.sourceChip, source === 'community' && styles.sourceChipActive]}
        >
          <Ionicons name="people" size={13} color={source === 'community' ? COLORS.brand : COLORS.onSurfaceSecondary} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sourceText, source === 'community' && styles.sourceTextActive]}>Community</Text>
        </Pressable>
        <Pressable
          testID="source-local-import"
          onPress={openLocalImport}
          style={[styles.sourceChip, source === 'local' && styles.sourceChipActive]}
        >
          <Ionicons name="folder-open" size={13} color={source === 'local' ? COLORS.brand : COLORS.onSurfaceSecondary} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sourceText, source === 'local' && styles.sourceTextActive]}>Import</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.onSurfaceTertiary} />
        <TextInput
          testID="discover-search"
          value={q}
          onChangeText={setQ}
          placeholder={source === 'community' ? 'Search profiles, tags...' : source === 'local' ? 'Search local PEQ files...' : 'Search headphones...'}
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.searchInput}
          onSubmitEditing={load}
          returnKeyType="search"
        />
      </View>

      {source === 'community' ? (
        <View style={styles.sortRow}>
          {sorts.map((s) => (
            <Pressable
              key={s.k}
              testID={`sort-${s.k}`}
              onPress={() => setSort(s.k)}
              style={[styles.sortChip, sort === s.k && styles.sortChipActive]}
            >
              <Ionicons name={s.icon} size={12} color={sort === s.k ? COLORS.brand : COLORS.onSurfaceSecondary} />
              <Text style={[styles.sortText, sort === s.k && styles.sortTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : source === 'local' ? (
        <View style={styles.localImportHeader}>
          <Text style={styles.sectionNote}>{filteredLocalProfiles.length} local presets from selected Android folder</Text>
          <Pressable testID="pick-local-peq-folder" onPress={pickLocalPeqFolder} style={styles.localImportBtn}>
            <Ionicons name="folder-open-outline" size={14} color={COLORS.onBrandPrimary} />
            <Text style={styles.localImportBtnText}>Choose Folder</Text>
          </Pressable>
        </View>
      ) : source === 'autoeq' ? (
        <Text style={styles.sectionNote}>{filteredAutoEqProfiles.length} searchable AutoEq headphone profiles</Text>
      ) : (
        <Text style={styles.sectionNote}>{filteredPeqProfiles.length} searchable PEQ presets from kaurav99/PEQ-AutoEQ</Text>
      )}

      {loading ? (
        <View style={{ paddingTop: 50, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : source === 'peq' ? (
        <FlatList
          data={filteredPeqProfiles}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelectedPeq(item)} testID={`peq-profile-${item.id}`}>
              <GlassCard>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{item.source} / {item.kind}</Text>
                  </View>
                  <View style={styles.peqBadge}>
                    <Text style={styles.peqBadgeText}>PEQ</Text>
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          )}
          ListEmptyComponent={() => (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="search-outline" size={48} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.subtitle}>No PEQ files found</Text>
            </View>
          )}
        />
      ) : source === 'autoeq' ? (
        <FlatList
          data={filteredAutoEqProfiles}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelectedAutoEq(item)} testID={`autoeq-profile-${item.id}`}>
              <GlassCard>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{item.source} / {item.measurement}</Text>
                  </View>
                  <View style={styles.peqBadge}>
                    <Text style={styles.peqBadgeText}>AEQ</Text>
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          )}
          ListEmptyComponent={() => (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="search-outline" size={48} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.subtitle}>No AutoEq profiles found</Text>
            </View>
          )}
        />
      ) : source === 'local' ? (
        <FlatList
          data={filteredLocalProfiles}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelectedLocal(item)} testID={`local-peq-profile-${item.id}`}>
              <GlassCard>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>Local Android folder</Text>
                  </View>
                  <View style={styles.peqBadge}>
                    <Text style={styles.peqBadgeText}>{item.kind}</Text>
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          )}
          ListEmptyComponent={() => (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="folder-open-outline" size={48} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.subtitle}>Choose a folder with .peq or .txt files</Text>
              <Pressable testID="empty-pick-local-peq-folder" onPress={pickLocalPeqFolder} style={[styles.localImportBtn, { marginTop: SPACING.md }]}>
                <Ionicons name="folder-open-outline" size={14} color={COLORS.onBrandPrimary} />
                <Text style={styles.localImportBtnText}>Choose Folder</Text>
              </Pressable>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelected(item)} testID={`profile-${item.id}`}>
              <GlassCard>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>by {item.author} · {item.bands.length} bands</Text>
                  </View>
                  <Pressable
                    testID={`star-${item.id}`}
                    onPress={() => handleStar(item)}
                    hitSlop={10}
                    style={[styles.starBtn, item.starred && styles.starBtnActive]}
                  >
                    <Ionicons name={item.starred ? 'star' : 'star-outline'} size={14} color={item.starred ? COLORS.brand : COLORS.onSurfaceSecondary} />
                    <Text style={[styles.starCount, item.starred && { color: COLORS.brand }]}>{item.stars}</Text>
                  </Pressable>
                </View>
                {!!item.description && <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>}
                <View style={styles.miniGraph}>
                  <FrequencyGraph bands={item.bands as any} preamp={item.preamp} width={screenWidth - SPACING.lg * 2 - 32} height={70} />
                </View>
                {item.tags.length > 0 && (
                  <View style={styles.tags}>
                    {item.tags.slice(0, 4).map((t) => (
                      <View key={t} style={styles.tag}><Text style={styles.tagText}>#{t}</Text></View>
                    ))}
                  </View>
                )}
              </GlassCard>
            </Pressable>
          )}
          ListEmptyComponent={() => (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="search-outline" size={48} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.subtitle}>No profiles found</Text>
            </View>
          )}
        />
      )}

      {/* Local PEQ detail sheet */}
      <Modal visible={!!selectedLocal} transparent animationType="fade" onRequestClose={() => setSelectedLocal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedLocal(null)}>
          <Pressable style={styles.detailSheet} onPress={(e) => e.stopPropagation()}>
            {selectedLocal && (
              <>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selectedLocal.name}</Text>
                    <Text style={styles.detailMeta}>Local {selectedLocal.kind} preset</Text>
                  </View>
                  <Pressable onPress={() => setSelectedLocal(null)} hitSlop={10}>
                    <Ionicons name="close" size={22} color={COLORS.onSurface} />
                  </Pressable>
                </View>
                <Text style={styles.detailDesc}>Imported from the Android folder you selected. Applying it loads the file into Parametric EQ.</Text>
                <View style={styles.actions}>
                  <Pressable testID="apply-local-peq-btn" onPress={() => applyLocalToEQ(selectedLocal)} style={[styles.actionBtn, styles.actionPrimary]}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.onBrandPrimary} />
                    <Text style={styles.actionPrimaryText}>Apply Import</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* PEQ detail sheet */}
      <Modal visible={!!selectedPeq} transparent animationType="fade" onRequestClose={() => setSelectedPeq(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPeq(null)}>
          <Pressable style={styles.detailSheet} onPress={(e) => e.stopPropagation()}>
            {selectedPeq && (
              <>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selectedPeq.name}</Text>
                    <Text style={styles.detailMeta}>{selectedPeq.source} / {selectedPeq.kind}</Text>
                  </View>
                  <Pressable onPress={() => setSelectedPeq(null)} hitSlop={10}>
                    <Ionicons name="close" size={22} color={COLORS.onSurface} />
                  </Pressable>
                </View>
                <Text style={styles.detailDesc}>PEQ-AutoEQ preset converted from AutoEQ. Applying it loads the profile into Parametric EQ.</Text>
                <View style={styles.actions}>
                  <Pressable testID="apply-peq-btn" onPress={() => applyPeqToEQ(selectedPeq)} style={[styles.actionBtn, styles.actionPrimary]}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.onBrandPrimary} />
                    <Text style={styles.actionPrimaryText}>Apply PEQ</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* AutoEq detail sheet */}
      <Modal visible={!!selectedAutoEq} transparent animationType="fade" onRequestClose={() => setSelectedAutoEq(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedAutoEq(null)}>
          <Pressable style={styles.detailSheet} onPress={(e) => e.stopPropagation()}>
            {selectedAutoEq && (
              <>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selectedAutoEq.name}</Text>
                    <Text style={styles.detailMeta}>{selectedAutoEq.source} / {selectedAutoEq.measurement}</Text>
                  </View>
                  <Pressable onPress={() => setSelectedAutoEq(null)} hitSlop={10}>
                    <Ionicons name="close" size={22} color={COLORS.onSurface} />
                  </Pressable>
                </View>
                <Text style={styles.detailDesc}>AutoEq headphone profile. Applying it imports the ParametricEQ file into the native PEQ chain.</Text>
                <View style={styles.actions}>
                  <Pressable testID="apply-autoeq-btn" onPress={() => applyAutoEqToEQ(selectedAutoEq)} style={[styles.actionBtn, styles.actionPrimary]}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.onBrandPrimary} />
                    <Text style={styles.actionPrimaryText}>Apply AutoEq</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Detail sheet */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.detailSheet} onPress={(e) => e.stopPropagation()}>
            {selected && (
              <>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selected.name}</Text>
                    <Text style={styles.detailMeta}>by {selected.author} · {selected.stars}★ · {selected.downloads}↓</Text>
                  </View>
                  <Pressable onPress={() => setSelected(null)} hitSlop={10}>
                    <Ionicons name="close" size={22} color={COLORS.onSurface} />
                  </Pressable>
                </View>
                {!!selected.description && <Text style={styles.detailDesc}>{selected.description}</Text>}
                <View style={{ marginTop: SPACING.md, marginBottom: SPACING.md }}>
                  <FrequencyGraph bands={selected.bands as any} preamp={selected.preamp} width={screenWidth - SPACING.lg * 2 - 32} height={120} />
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Preamp</Text>
                  <Text style={styles.detailValue}>{selected.preamp.toFixed(1)} dB</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Bands</Text>
                  <Text style={styles.detailValue}>{selected.bands.length}</Text>
                </View>
                <View style={styles.actions}>
                  <Pressable testID="apply-profile-btn" onPress={() => applyToEQ(selected)} style={[styles.actionBtn, styles.actionPrimary]}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.onBrandPrimary} />
                    <Text style={styles.actionPrimaryText}>Apply</Text>
                  </Pressable>
                  <Pressable testID="share-profile-btn" onPress={() => shareConfig(selected)} style={[styles.actionBtn, styles.actionSecondary]}>
                    <Ionicons name="share-outline" size={16} color={COLORS.onSurface} />
                    <Text style={styles.actionSecondaryText}>Share</Text>
                  </Pressable>
                  <Pressable testID="detail-star-btn" onPress={() => handleStar(selected)} style={[styles.actionBtn, styles.actionSecondary]}>
                    <Ionicons name={selected.starred ? 'star' : 'star-outline'} size={16} color={selected.starred ? COLORS.brand : COLORS.onSurface} />
                    <Text style={styles.actionSecondaryText}>{selected.starred ? 'Starred' : 'Star'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Publish modal */}
      <Modal visible={publishOpen} transparent animationType="fade" onRequestClose={() => setPublishOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPublishOpen(false)}>
          <Pressable style={styles.detailSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.detailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTitle}>Publish your EQ</Text>
                <Text style={styles.detailMeta}>Share with the community</Text>
              </View>
              <Pressable onPress={() => setPublishOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={COLORS.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.label}>Name</Text>
            <TextInput
              testID="publish-name"
              value={publishName} onChangeText={setPublishName}
              placeholder="Velvet Highs" placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.input}
            />
            <Text style={styles.label}>Author handle</Text>
            <TextInput
              testID="publish-author"
              value={publishAuthor} onChangeText={setPublishAuthor}
              placeholder="audiofan42" placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.input}
            />
            <Text style={styles.label}>Description</Text>
            <TextInput
              testID="publish-desc"
              value={publishDesc} onChangeText={setPublishDesc}
              placeholder="Optional notes about the tuning"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={[styles.input, { minHeight: 70 }]}
              multiline
            />
            <Pressable
              testID="publish-confirm"
              disabled={publishing}
              onPress={handlePublish}
              style={[styles.actionBtn, styles.actionPrimary, { marginTop: SPACING.md, opacity: publishing ? 0.6 : 1 }]}
            >
              <Ionicons name="cloud-upload" size={16} color={COLORS.onBrandPrimary} />
              <Text style={styles.actionPrimaryText}>{publishing ? 'Publishing…' : 'Publish'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 24 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md, gap: SPACING.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  title: { color: COLORS.onSurface, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  publishBtn: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  publishBtnText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 12 },
  sourceRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  sourceChip: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4, paddingVertical: 9, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'transparent' },
  sourceChipActive: { backgroundColor: COLORS.brandTertiary, borderColor: COLORS.brand },
  sourceText: { flexShrink: 1, color: COLORS.onSurfaceSecondary, fontSize: 10, fontWeight: '700' },
  sourceTextActive: { color: COLORS.brand },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.md, marginHorizontal: SPACING.lg, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: COLORS.onSurface, paddingVertical: 10, fontSize: 13 },
  sectionNote: { color: COLORS.onSurfaceSecondary, fontSize: 11, marginTop: SPACING.md, marginBottom: SPACING.md, paddingHorizontal: SPACING.lg },
  localImportHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, paddingRight: SPACING.lg },
  localImportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  localImportBtnText: { color: COLORS.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.md },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.04)' },
  sortChipActive: { backgroundColor: COLORS.brandTertiary, borderWidth: 1, borderColor: COLORS.brand },
  sortText: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  sortTextActive: { color: COLORS.brand },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: COLORS.onSurface, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: COLORS.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  desc: { color: COLORS.onSurfaceTertiary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  miniGraph: { marginTop: SPACING.md, alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm },
  tag: { backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.sm },
  tagText: { color: COLORS.onSurfaceSecondary, fontSize: 10, fontWeight: '600' },
  starBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.06)' },
  starBtnActive: { backgroundColor: COLORS.brandTertiary },
  starCount: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  peqBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADIUS.pill, backgroundColor: COLORS.brandTertiary },
  peqBadgeText: { color: COLORS.brand, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  detailSheet: { backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailTitle: { color: COLORS.onSurface, fontSize: 20, fontWeight: '800' },
  detailMeta: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  detailDesc: { color: COLORS.onSurfaceTertiary, fontSize: 13, marginTop: SPACING.sm, lineHeight: 18 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: COLORS.onSurfaceSecondary, fontSize: 12 },
  detailValue: { color: COLORS.onSurface, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: SPACING.lg },
  actionBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: RADIUS.md },
  actionPrimary: { backgroundColor: COLORS.brand },
  actionPrimaryText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  actionSecondary: { backgroundColor: 'rgba(255,255,255,0.06)' },
  actionSecondaryText: { color: COLORS.onSurface, fontWeight: '600', fontSize: 13 },
  label: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: SPACING.md, marginBottom: 6 },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.onSurface, fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(245,158,11,0.95)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill },
  toastText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '700' },
});
