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
