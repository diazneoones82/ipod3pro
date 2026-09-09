import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { type FolderInfo } from '@/src/state/PlayerContext';
import { fetchAlbumArt } from '@/src/utils/api';
import { safeFileName, trackLookupParts } from '@/src/utils/track-lookup';

export const YOUTUBE_API_KEY_STORAGE = '@shuffleimusic/youtube_api_key';

function normMatch(text?: string): string {
  return String(text || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\[[^\]]*]|\([^)]*\)/g, ' ')
    .replace(/\b(official|audio|video|lyrics?|lyric video|remaster(?:ed)?|radio edit|explicit|clean)\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function scoreArtCandidate(candidate: { title?: string; artist?: string; album?: string; durationMs?: number }, expected: { title: string; artist?: string; album?: string; duration?: number }) {
  let score = similarity(candidate.title, expected.title) * 0.54;
  score += expected.artist ? similarity(candidate.artist, expected.artist) * 0.30 : 0.08;
  score += expected.album ? similarity(candidate.album, expected.album) * 0.10 : 0.04;
  score += durationScore(candidate.durationMs, expected.duration) * 0.08;
  return score;
}

export async function getYouTubeAlbumArtApiKey() {
  const saved = await AsyncStorage.getItem(YOUTUBE_API_KEY_STORAGE).catch(() => '');
  return String(saved || process.env.EXPO_PUBLIC_YOUTUBE_API_KEY || '').trim();
}

export async function setYouTubeAlbumArtApiKey(key: string) {
  const next = key.trim();
  if (next) await AsyncStorage.setItem(YOUTUBE_API_KEY_STORAGE, next);
  else await AsyncStorage.removeItem(YOUTUBE_API_KEY_STORAGE);
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function lookupMusicBrainzArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  if (!parts.album) return '';
  const query = [
    `release:"${parts.album.replace(/"/g, '')}"`,
    parts.artist ? `artist:"${parts.artist.replace(/"/g, '')}"` : '',
  ].filter(Boolean).join(' AND ');
  const json = await fetchJson(`https://musicbrainz.org/ws/2/release/?fmt=json&limit=8&query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'ShuffleMuSic/1.0.0 (local album art lookup)' },
  });
  const releases = Array.isArray(json?.releases) ? json.releases : [];
  const best = releases
    .map((item: any) => ({
      item,
      score: similarity(item?.title, parts.album) * 0.62 + (parts.artist ? similarity(item?.['artist-credit']?.[0]?.name, parts.artist) * 0.38 : 0.18),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .find((entry: any) => entry.score >= (parts.artist ? 0.72 : 0.58));
  return best?.item?.id ? `https://coverartarchive.org/release/${best.item.id}/front-1200` : '';
}

async function lookupDeezerArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  const term = [parts.artist, parts.title, parts.album].filter(Boolean).join(' ');
  const json = await fetchJson(`https://api.deezer.com/search?limit=15&q=${encodeURIComponent(term)}`);
  const best = Array.isArray(json?.data)
    ? json.data
        .map((item: any) => ({
          item,
          score: scoreArtCandidate(
            { title: item?.title, artist: item?.artist?.name, album: item?.album?.title, durationMs: item?.duration ? item.duration * 1000 : undefined },
            parts,
          ),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .find((entry: any) => entry.score >= (parts.artist && parts.album ? 0.76 : parts.artist ? 0.70 : 0.58))
    : null;
  return best?.item?.album?.cover_xl || best?.item?.album?.cover_big || '';
}

async function lookupITunesArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  const term = [parts.artist, parts.title, parts.album].filter(Boolean).join(' ');
  const json = await fetchJson(`https://itunes.apple.com/search?media=music&entity=song&limit=15&country=US&term=${encodeURIComponent(term)}`);
  const best = Array.isArray(json?.results)
    ? json.results
        .map((item: any) => ({
          item,
          score: scoreArtCandidate(
            { title: item?.trackName, artist: item?.artistName, album: item?.collectionName, durationMs: item?.trackTimeMillis },
            parts,
          ),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .find((entry: any) => entry.score >= (parts.artist && parts.album ? 0.76 : parts.artist ? 0.70 : 0.58))
    : null;
  return best?.item?.artworkUrl100
    ? String(best.item.artworkUrl100).replace(/100x100bb\.(jpg|png)$/i, '1200x1200bb.$1')
    : '';
}

async function lookupYouTubeMusicArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  const key = await getYouTubeAlbumArtApiKey();
  if (!key) {
    console.log('[album-art] youtube skipped: missing saved/API key');
    return '';
  }
  const term = [parts.artist, parts.title, 'official audio'].filter(Boolean).join(' ');
  const json = await fetchJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(term)}&key=${encodeURIComponent(key)}`);
  const best = Array.isArray(json?.items)
    ? json.items
        .map((item: any) => ({
          item,
          score: scoreArtCandidate({ title: item?.snippet?.title, artist: item?.snippet?.channelTitle }, parts),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .find((entry: any) => entry.score >= (parts.artist ? 0.58 : 0.48))
    : null;
  const thumbs = best?.item?.snippet?.thumbnails;
  return thumbs?.maxres?.url || thumbs?.standard?.url || thumbs?.high?.url || '';
}

async function lookupBackendArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  const found = await fetchAlbumArt({
    track: parts.title,
    artist: parts.artist,
    album: parts.album,
    duration: parts.duration,
  });
  return found.artworkUrl || '';
}

export async function lookupAlbumArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  const lookups = [
    ['youtube', lookupYouTubeMusicArtUrl],
    ['backend', lookupBackendArtUrl],
    ['musicbrainz', lookupMusicBrainzArtUrl],
    ['deezer', lookupDeezerArtUrl],
    ['itunes', lookupITunesArtUrl],
  ] as const;
  for (const [source, lookup] of lookups) {
    try {
      const url = await lookup(parts);
      if (url) {
        console.log(`[album-art] source=${source}`);
        return url;
      }
    } catch (e) {
      console.log(`[album-art] ${source} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return '';
}

function folderFileUri(folderPath: string, fileName: string) {
  if (!folderPath || folderPath === 'unknown' || folderPath.startsWith('album:')) return '';
  const normalizedFolder = folderPath.startsWith('file://') ? folderPath : `file://${folderPath}`;
  return `${normalizedFolder.replace(/\/+$/, '')}/${encodeURIComponent(fileName)}`;
}

function trackArtFileName(filename: string) {
  return `${safeFileName(filename.replace(/\.[^.]+$/, '') || 'album_art')}.jpg`;
}

async function existingLocalArtUri(folderPath: string, names: string[]) {
  for (const name of names) {
    const uri = folderFileUri(folderPath, name);
    if (!uri) continue;
    try {
      if ((await FileSystem.getInfoAsync(uri)).exists) return uri;
    } catch {}
  }
  return '';
}

export async function saveAlbumArtUrlForTrack(artworkUrl: string, track: FolderInfo['tracks'][number], fallbackDir?: string) {
  const exactName = trackArtFileName(track.filename);
  const exactUri = folderFileUri(track.folder, exactName);
  if (exactUri) {
    try {
      const downloaded = await FileSystem.downloadAsync(artworkUrl, exactUri);
      const hasFolderCover = await existingLocalArtUri(track.folder, ['cover.jpg', 'folder.jpg', 'album.jpg', 'front.jpg']);
      if (!hasFolderCover) {
        const coverUri = folderFileUri(track.folder, 'cover.jpg');
        if (coverUri) await FileSystem.copyAsync({ from: downloaded.uri, to: coverUri }).catch(() => {});
      }
      return downloaded.uri;
    } catch {}
  }

  if (fallbackDir) {
    try {
      await FileSystem.makeDirectoryAsync(fallbackDir, { intermediates: true }).catch(() => {});
      const downloaded = await FileSystem.downloadAsync(artworkUrl, `${fallbackDir}${safeFileName(track.id)}.jpg`);
      return downloaded.uri;
    } catch {
      return '';
    }
  }

  return '';
}

export async function pullAlbumArtForFolder(
  folder: FolderInfo,
  artworkOverrides: Record<string, string>,
  setTrackArtwork: (trackId: string, uri: string, track?: FolderInfo['tracks'][number]) => void,
) {
  let updated = 0;
  let checked = 0;
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!baseDir) throw new Error('App storage unavailable');
  const dir = `${baseDir}album-art/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

  for (const track of folder.tracks) {
    checked += 1;
    const localArt = await existingLocalArtUri(track.folder, [
      trackArtFileName(track.filename),
    ]);
    if (localArt) {
      setTrackArtwork(track.id, localArt, track);
      continue;
    }
    const parts = trackLookupParts(track);
    try {
      const artworkUrl = await lookupAlbumArtUrl(parts);
      if (!artworkUrl) continue;
      const savedUri = await saveAlbumArtUrlForTrack(artworkUrl, track, dir);
      if (savedUri) {
        setTrackArtwork(track.id, savedUri, track);
        updated += 1;
      }
    } catch {}
  }

  return { updated, checked };
}
