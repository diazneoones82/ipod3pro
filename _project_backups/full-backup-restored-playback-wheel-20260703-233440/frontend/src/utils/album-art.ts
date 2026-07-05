import * as FileSystem from 'expo-file-system/legacy';

import { trackArtworkKey, type FolderInfo } from '@/src/state/PlayerContext';
import { fetchAlbumArt } from '@/src/utils/api';
import { safeFileName, trackLookupParts } from '@/src/utils/track-lookup';

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

async function lookupAlbumArtUrl(parts: { title: string; artist?: string; album?: string; duration?: number }) {
  try {
    const found = await fetchAlbumArt({
      track: parts.title,
      artist: parts.artist,
      album: parts.album,
      duration: parts.duration,
    });
    if (found.artworkUrl) return found.artworkUrl;
  } catch {}

  const term = [parts.artist, parts.title, parts.album].filter(Boolean).join(' ');
  const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=15&country=US&term=${encodeURIComponent(term)}`);
  const json = await res.json();
  const best = Array.isArray(json?.results)
    ? json.results
        .map((item: any) => ({
          item,
          score: scoreArtCandidate(
            { title: item?.trackName, artist: item?.artistName, album: item?.collectionName, durationMs: item?.trackTimeMillis },
            { title: parts.title, artist: parts.artist, album: parts.album, duration: parts.duration },
          ),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .find((entry: any) => entry.score >= (parts.artist && parts.album ? 0.76 : parts.artist ? 0.70 : 0.58))
    : null;
  return best?.item?.artworkUrl100
    ? String(best.item.artworkUrl100).replace(/100x100bb\.(jpg|png)$/i, '1200x1200bb.$1')
    : '';
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
    if (artworkOverrides[track.id] || artworkOverrides[trackArtworkKey(track)]) continue;
    const parts = trackLookupParts(track);
    try {
      const artworkUrl = await lookupAlbumArtUrl(parts);
      if (!artworkUrl) continue;
      const localPath = `${dir}${safeFileName(track.id)}.jpg`;
      const downloaded = await FileSystem.downloadAsync(artworkUrl, localPath);
      if (downloaded.uri) {
        setTrackArtwork(track.id, downloaded.uri, track);
        updated += 1;
      }
    } catch {}
  }

  return { updated, checked };
}
