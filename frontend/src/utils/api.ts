import { getAnonUserId } from '@/src/utils/anon-user';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export type RemoteEQBand = {
  enabled: boolean;
  type: 'PK' | 'LSC' | 'HSC' | 'LP' | 'HP' | 'NO' | 'AP' | 'BP';
  freq: number;
  gain: number;
  q: number;
};

export type RemoteEQProfile = {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  preamp: number;
  bands: RemoteEQBand[];
  stars: number;
  downloads: number;
  starred: boolean;
  created_at: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function listProfiles(opts?: { sort?: 'trending' | 'new' | 'stars'; q?: string }): Promise<RemoteEQProfile[]> {
  const userId = await getAnonUserId();
  const params = new URLSearchParams();
  if (opts?.sort) params.set('sort', opts.sort);
  if (opts?.q) params.set('q', opts.q);
  params.set('user_id', userId);
  return api<RemoteEQProfile[]>(`/eq-profiles?${params}`);
}

export async function getProfile(id: string): Promise<RemoteEQProfile> {
  const userId = await getAnonUserId();
  return api<RemoteEQProfile>(`/eq-profiles/${id}?user_id=${userId}`);
}

export async function publishProfile(payload: {
  name: string; author: string; description?: string; tags?: string[];
  preamp: number; bands: RemoteEQBand[];
}): Promise<RemoteEQProfile> {
  const userId = await getAnonUserId();
  return api<RemoteEQProfile>(`/eq-profiles?user_id=${userId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function toggleStar(id: string): Promise<{ stars: number; starred: boolean }> {
  const userId = await getAnonUserId();
  return api<{ stars: number; starred: boolean }>(`/eq-profiles/${id}/star`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function profileConfigUrl(id: string): string {
  return `${BASE}/api/eq-profiles/${id}/config`;
}

export type LyricsResult = {
  source: string;
  title: string;
  artist: string;
  album?: string;
  plainLyrics: string;
  syncedLyrics?: string;
  providerTrackId?: string;
};

export async function fetchLyrics(opts: { track: string; artist?: string; album?: string; duration?: number }): Promise<LyricsResult> {
  const params = new URLSearchParams();
  params.set('track', opts.track);
  if (opts.artist) params.set('artist', opts.artist);
  if (opts.album) params.set('album', opts.album);
  if (opts.duration) params.set('duration', String(Math.round(opts.duration)));
  return api<LyricsResult>(`/lyrics?${params}`);
}

export type AlbumArtResult = {
  source: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  score: number;
};

export async function fetchAlbumArt(opts: { track: string; artist?: string; album?: string; duration?: number }): Promise<AlbumArtResult> {
  const params = new URLSearchParams();
  params.set('track', opts.track);
  if (opts.artist) params.set('artist', opts.artist);
  if (opts.album) params.set('album', opts.album);
  if (opts.duration) params.set('duration', String(Math.round(opts.duration)));
  return api<AlbumArtResult>(`/album-art?${params}`);
}
