import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Alert, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, currentTrack } from '@/src/state/PlayerContext';
import { fetchLyrics } from '@/src/utils/api';
import { readNativeAudioTags } from '@/src/native/ShuffleEqualizer';
import { trackLookupParts, cleanToken } from '@/src/utils/track-lookup';
import { parseLrc, findLineIndex, formatLrcTime, type LrcEntry } from '@/src/utils/lrc-parser';

const BG_IMAGE = 'https://images.pexels.com/photos/9807251/pexels-photo-9807251.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

const devanagariIndependentVowels: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};
const devanagariConsonants: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ळ': 'l', 'क्ष': 'ksh', 'ज्ञ': 'gy',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f',
};
const devanagariVowelMarks: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};
const devanagariSigns: Record<string, string> = {
  'ं': 'n', 'ँ': 'n', 'ः': 'h', '़': '', 'ॅ': 'e', 'ॉ': 'o', '्': '',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

function romanizeDevanagari(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const pair = input.slice(i, i + 2);
    const consonant = devanagariConsonants[pair] ? pair : ch;
    if (devanagariConsonants[consonant]) {
      const next = input[i + consonant.length];
      if (devanagariVowelMarks[next] != null) {
        out += devanagariConsonants[consonant] + devanagariVowelMarks[next];
        i += consonant.length;
      } else if (next === '\u094D') {
        out += devanagariConsonants[consonant];
        i += consonant.length;
      } else {
        out += devanagariConsonants[consonant] + 'a';
        i += consonant.length - 1;
      }
      continue;
    }
    out += devanagariIndependentVowels[ch] ?? devanagariVowelMarks[ch] ?? devanagariSigns[ch] ?? ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function romanizeText(input: string): string {
  if (!/[\u0900-\u097F]/.test(input)) return input;
  return input
    .split('\n')
    .map((line) => romanizeDevanagari(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normMatch(text?: string): string {
  return cleanToken(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(a?: string, b?: string): number {
  const aa = normMatch(a);
  const bb = normMatch(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.88;
  const aWords = new Set(aa.split(' '));
  const bWords = new Set(bb.split(' '));
  const overlap = [...aWords].filter((word) => bWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.size);
}

function durationScore(candidateMs?: number, targetSec?: number): number {
  if (!candidateMs || !targetSec) return 0;
  const diff = Math.abs(candidateMs / 1000 - targetSec);
  if (diff <= 2) return 1;
  if (diff <= 6) return 0.75;
  if (diff <= 12) return 0.35;
  return -0.25;
}

function scoreCandidate(
  candidate: { title?: string; artist?: string; album?: string; durationMs?: number },
  expected: { title: string; artist?: string; album?: string; duration?: number },
): number {
  let score = similarity(candidate.title, expected.title) * 0.54;
  score += expected.artist ? similarity(candidate.artist, expected.artist) * 0.30 : 0.08;
  score += expected.album ? similarity(candidate.album, expected.album) * 0.10 : 0.04;
  score += durationScore(candidate.durationMs, expected.duration) * 0.08;
  return score;
}

export default function LyricsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const track = currentTrack(player);
  const flatRef = useRef<FlatList>(null);
  const userScrolling = useRef(false);

  const [status, setStatus] = useState<Status>('idle');
  const [lrcEntries, setLrcEntries] = useState<LrcEntry[]>([]);
  const [plainText, setPlainText] = useState('');
  const [source, setSourceName] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [displayArtist, setDisplayArtist] = useState('');
  const [displayAlbum, setDisplayAlbum] = useState('');
  const [translating, setTranslating] = useState(false);

  const lyricQuery = useMemo(() => {
    if (!track) return '';
    return trackLookupParts(track).title;
  }, [track]);
  const lyricArtist = useMemo(() => (track ? trackLookupParts(track).artist : undefined), [track]);
  const lyricAlbum = useMemo(() => (track ? trackLookupParts(track).album : undefined), [track]);

  const fetchAndLoad = useCallback(async () => {
    if (!lyricQuery) return;
    setStatus('loading');
    setLrcEntries([]);
    setPlainText('');
    setSourceName('');
    setDisplayTitle(lyricQuery);
    setDisplayArtist(lyricArtist || '');
    setDisplayAlbum(lyricAlbum || '');

    const tryParse = (raw: string, src: string): boolean => {
      if (!raw.trim()) return false;
      const parsed = parseLrc(raw);
      if (parsed.isSynced) {
        setLrcEntries(parsed.entries);
      } else {
        setPlainText(raw);
      }
      setSourceName(src);
      setStatus('loaded');
      return true;
    };

    try {
      // 1. Embedded ID3 tags
      if (track?.uri) {
        const tags = await readNativeAudioTags(track.uri);
        if (tags?.lyrics && tryParse(tags.lyrics, 'Embedded tags')) return;
      }

      // 2. Sidecar .lrc file alongside the audio file
      if (track?.uri && track.uri.startsWith('file://')) {
        const lrcPath = track.uri.replace(/\.\w+$/, '.lrc');
        const fileInfo = await FileSystem.getInfoAsync(lrcPath);
        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(lrcPath);
          if (tryParse(content, 'LRC file')) return;
        }
      }

      // 3. Backend API
      try {
        const found = await fetchLyrics({ track: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track?.duration });
        setDisplayTitle(found.title || lyricQuery);
        setDisplayArtist(found.artist || lyricArtist || '');
        setDisplayAlbum(found.album || '');
        if (tryParse(found.syncedLyrics || found.plainLyrics || '', found.source)) return;
      } catch {}

      // 4. LRCLIB (scored matching)
      let bestMatches: { item: any; score: number }[] = [];
      try {
        const params = new URLSearchParams({ track_name: lyricQuery });
        if (lyricArtist) params.set('artist_name', lyricArtist);
        if (lyricAlbum) params.set('album_name', lyricAlbum);
        const res = await fetch(`https://lrclib.net/api/search?${params}`);
        const matches = await res.json();
        if (Array.isArray(matches)) {
          bestMatches = matches
            .filter((m: any) => m?.plainLyrics || m?.syncedLyrics)
            .map((m: any) => ({
              item: m,
              score: scoreCandidate(
                { title: m?.trackName, artist: m?.artistName, album: m?.albumName, durationMs: m?.duration ? Number(m.duration) * 1000 : undefined },
                { title: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track?.duration },
              ),
            }))
            .sort((a: any, b: any) => b.score - a.score);
          const threshold = lyricArtist && lyricAlbum ? 0.65 : lyricArtist ? 0.55 : 0.40;
          const match = bestMatches.find((m: any) => m.score >= threshold)?.item;
          if (match) {
            setDisplayTitle(match?.trackName || lyricQuery);
            setDisplayArtist(match?.artistName || lyricArtist || '');
            setDisplayAlbum(match?.albumName || '');
            if (tryParse(match?.syncedLyrics || match?.plainLyrics || '', 'LRCLIB')) return;
          }
        }
      } catch {}

      // 5. Lyrics.ovh (plain text, no key needed)
      if (lyricArtist) {
        try {
          const ovhRes = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(lyricArtist)}/${encodeURIComponent(lyricQuery)}`);
          if (ovhRes.ok) {
            const ovhData = await ovhRes.json();
            if (ovhData?.lyrics && tryParse(ovhData.lyrics, 'Lyrics.ovh')) return;
          }
        } catch {}
      }

      // 6. LRCLIB best match regardless of threshold
      for (const bm of bestMatches) {
        if (tryParse(bm.item?.syncedLyrics || bm.item?.plainLyrics || '', 'LRCLIB')) {
          setDisplayTitle(bm.item?.trackName || lyricQuery);
          setDisplayArtist(bm.item?.artistName || lyricArtist || '');
          setDisplayAlbum(bm.item?.albumName || '');
          return;
        }
      }

      setStatus('error');
    } catch {
      setStatus('error');
    }
  }, [lyricQuery, lyricArtist, lyricAlbum, track?.duration, track?.uri]);

  useEffect(() => {
    fetchAndLoad();
  }, [fetchAndLoad]);

  const currentLine = useMemo(() => {
    if (lrcEntries.length === 0) return -1;
    return findLineIndex(lrcEntries, player.positionSec * 1000);
  }, [lrcEntries, player.positionSec]);

  const prevLineRef = useRef(-1);
  useEffect(() => {
    if (currentLine < 0 || currentLine === prevLineRef.current) return;
    prevLineRef.current = currentLine;
    if (!userScrolling.current) {
      flatRef.current?.scrollToIndex({ index: currentLine, animated: true, viewPosition: 0.38 });
    }
  }, [currentLine]);

  const onScrollBegin = useCallback(() => { userScrolling.current = true; }, []);
  const onScrollEnd = useCallback(() => { userScrolling.current = false; }, []);

  const handleSeek = useCallback((timeMs: number) => {
    player.seekTo(timeMs / 1000);
  }, [player]);

  const handleShare = useCallback(async () => {
    const title = displayTitle || lyricQuery || 'Lyrics';
    const body = [
      title,
      displayArtist ? `Artist: ${displayArtist}` : '',
      displayAlbum ? `Album: ${displayAlbum}` : '',
      source ? `Source: ${source}` : '',
      '',
      plainText || lrcEntries.map((e) => `[${formatLrcTime(e.time)}] ${e.text}`).join('\n'),
    ].filter(Boolean).join('\n');
    if (!body.trim()) return;
    try {
      await Share.share({ title, message: body });
    } catch {}
  }, [displayTitle, lyricQuery, displayArtist, displayAlbum, source, plainText, lrcEntries]);

  const handleDownload = useCallback(async () => {
    const content = plainText || lrcEntries.map((e) => `[${formatLrcTime(e.time)}] ${e.text}`).join('\n');
    if (!content.trim()) return;
    try {
      const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!root) throw new Error();
      const dir = `${root}lyrics/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const safeName = `${displayTitle || lyricQuery || 'lyrics'}-${displayArtist || 'shuffle'}`.replace(/[^a-z0-9_-]+/gi, '_');
      const ext = lrcEntries.length > 0 ? '.lrc' : '.txt';
      const path = `${dir}${safeName}${ext}`;
      await FileSystem.writeAsStringAsync(path, content);
      Alert.alert('Lyrics saved', 'Lyrics saved in the app lyrics folder.', [
        { text: 'Share file', onPress: () => Sharing.shareAsync(path, { mimeType: ext === '.lrc' ? 'text/plain' : 'text/plain', dialogTitle: 'Share lyrics' }).catch(() => {}) },
        { text: 'OK' },
      ]);
    } catch {
      Alert.alert('Lyrics', 'Could not save lyrics.');
    }
  }, [plainText, lrcEntries, displayTitle, lyricQuery, displayArtist]);

  const handleRomanize = useCallback(async () => {
    if (translating) return;
    setTranslating(true);
    try {
      if (lrcEntries.length > 0) {
        setLrcEntries((prev) => prev.map((e) => ({ ...e, text: romanizeText(e.text) })));
      } else if (plainText) {
        const next = romanizeText(plainText);
        if (next !== plainText) setPlainText(next);
      }
      setSourceName((s) => (s ? `${s} \u00B7 English text` : 'English text'));
    } catch {
      Alert.alert('Lyrics', 'Could not convert to English text right now.');
    } finally {
      setTranslating(false);
    }
  }, [translating, lrcEntries, plainText]);

  const renderSyncedItem = useCallback(({ item, index }: { item: LrcEntry; index: number }) => {
    const isCurrent = index === currentLine;
    return (
      <Pressable
        onPress={() => handleSeek(item.time)}
        style={[styles.lineRow, isCurrent && styles.lineRowCurrent]}
      >
        <Text style={[styles.lineTime, isCurrent && styles.lineTimeCurrent]}>
          {formatLrcTime(item.time)}
        </Text>
        <Text
          style={[styles.lineText, isCurrent && styles.lineTextCurrent]}
          numberOfLines={isCurrent ? undefined : 2}
        >
          {item.text}
        </Text>
      </Pressable>
    );
  }, [currentLine, handleSeek]);

  const trackName = track ? trackLookupParts(track).title : '';
  const hasSynced = lrcEntries.length > 0;

  return (
    <View style={styles.container}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#05050A' }]} />
      <LinearGradient colors={['rgba(5,5,10,0.85)', 'rgba(5,5,10,0.97)', '#05050A']} style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
            </Pressable>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>{trackName || 'Lyrics'}</Text>
              {!!source && <Text style={styles.headerSource}>{source}</Text>}
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={handleRomanize} disabled={translating} hitSlop={8} style={[styles.headerBtn, translating && { opacity: 0.55 }]}>
                <Ionicons name={translating ? 'hourglass-outline' : 'language-outline'} size={18} color={COLORS.onSurface} />
              </Pressable>
              <Pressable onPress={handleDownload} hitSlop={8} style={styles.headerBtn}>
                <Ionicons name="download-outline" size={18} color={COLORS.onSurface} />
              </Pressable>
              <Pressable onPress={handleShare} hitSlop={8} style={styles.headerBtn}>
                <Ionicons name="share-social-outline" size={18} color={COLORS.onSurface} />
              </Pressable>
            </View>
          </View>

          {status === 'idle' || status === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.brand} size="large" />
              <Text style={styles.loadingText}>Searching lyrics...</Text>
            </View>
          ) : status === 'error' ? (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={48} color={COLORS.onSurfaceTertiary} />
              <Text style={styles.errorText}>No lyrics found for this song.</Text>
              <Text style={styles.errorHint}>Try searching online from your browser.</Text>
            </View>
          ) : hasSynced ? (
            <FlatList
              ref={flatRef}
              data={lrcEntries}
              keyExtractor={(_, i) => String(i)}
              renderItem={renderSyncedItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              onScrollBeginDrag={onScrollBegin}
              onScrollEndDrag={onScrollEnd}
              onMomentumScrollBegin={onScrollBegin}
              onMomentumScrollEnd={onScrollEnd}
              initialNumToRender={40}
              maxToRenderPerBatch={40}
              windowSize={7}
              onScrollToIndexFailed={(info) => {
                flatRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              }}
            />
          ) : (
            <View style={styles.plainWrap}>
              <View style={styles.infoBox}>
                {!!displayTitle && <Text style={styles.infoValue}>{displayTitle}</Text>}
                {!!displayArtist && <Text style={styles.infoMeta}>{displayArtist}</Text>}
              </View>
              <View style={styles.plainScroll}>
                <Text style={styles.plainText} selectable>{plainText}</Text>
              </View>
            </View>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  loadingText: { color: COLORS.onSurfaceTertiary, fontSize: 13, marginTop: SPACING.md, fontWeight: '600' },
  errorText: { color: COLORS.onSurfaceTertiary, fontSize: 15, fontWeight: '700', marginTop: SPACING.md, textAlign: 'center' },
  errorHint: { color: COLORS.onSurfaceTertiary, fontSize: 12, marginTop: SPACING.xs, textAlign: 'center', opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, gap: 8 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: { color: COLORS.onSurface, fontSize: 16, fontWeight: '800' },
  headerSource: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listContent: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: RADIUS.md, marginBottom: 2 },
  lineRowCurrent: { backgroundColor: 'rgba(245,158,11,0.08)' },
  lineTime: { color: COLORS.onSurfaceTertiary, fontSize: 11, fontWeight: '600', width: 44, fontVariant: ['tabular-nums'] },
  lineTimeCurrent: { color: COLORS.brand, fontWeight: '800' },
  lineText: { flex: 1, color: COLORS.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  lineTextCurrent: { color: COLORS.onSurface, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  plainWrap: { flex: 1, paddingHorizontal: SPACING.lg },
  infoBox: { paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  infoValue: { color: COLORS.onSurface, fontSize: 15, fontWeight: '700' },
  infoMeta: { color: COLORS.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  plainScroll: { flex: 1, paddingVertical: SPACING.md },
  plainText: { color: COLORS.onSurface, fontSize: 14, lineHeight: 22 },
});
