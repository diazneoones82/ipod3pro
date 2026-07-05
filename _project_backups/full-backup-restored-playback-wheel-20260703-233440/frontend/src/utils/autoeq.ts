import AsyncStorage from '@react-native-async-storage/async-storage';

const OWNER = 'jaakkopasanen';
const REPO = 'AutoEq';
const REF = 'master';
const RESULTS_ROOT = 'results';
const CACHE_KEY = '@shuffleimusic/autoeq_profiles_v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type GitHubContent = {
  name: string;
  path: string;
  type: 'dir' | 'file';
  download_url?: string;
};

export type AutoEqProfile = {
  id: string;
  name: string;
  source: string;
  measurement: string;
  path: string;
};

const SOURCES = ['Rtings', 'oratory1990', 'crinacle', 'Innerfidelity'];

function rawUrl(path: string): string {
  const encoded = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${encoded}`;
}

function contentsUrl(path: string): string {
  const encoded = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encoded}?ref=${REF}`;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function parseProfiles(source: string, readme: string): AutoEqProfile[] {
  const profiles: AutoEqProfile[] = [];
  const seen = new Set<string>();
  const linkPattern = /[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?:\s+on\s+([^*\r\n]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(readme))) {
    const name = match[1]?.trim();
    const href = decodePath((match[2] || '').trim()).replace(/^\.\//, '');
    if (!name || !href || href.startsWith('http') || href.toLowerCase().endsWith('.md')) continue;
    const path = `${RESULTS_ROOT}/${source}/${href}`.replace(/\/+/g, '/');
    if (seen.has(path)) continue;
    seen.add(path);
    profiles.push({
      id: path,
      name,
      source,
      measurement: (match[3] || href.split('/')[0] || '').trim(),
      path,
    });
  }
  return profiles;
}

export async function listAutoEqProfiles(): Promise<AutoEqProfile[]> {
  const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { savedAt: number; profiles: AutoEqProfile[] };
      if (Date.now() - parsed.savedAt < CACHE_TTL_MS && Array.isArray(parsed.profiles)) {
        return parsed.profiles;
      }
    } catch {
      // Ignore invalid cache and refresh from GitHub.
    }
  }
  const batches = await Promise.all(SOURCES.map(async (source) => {
    const res = await fetch(rawUrl(`${RESULTS_ROOT}/${source}/README.md`));
    if (!res.ok) return [];
    return parseProfiles(source, await res.text());
  }));
  const profiles = batches
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name));
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), profiles })).catch(() => {});
  return profiles;
}

export async function resolveAutoEqParametricConfig(profile: AutoEqProfile): Promise<string> {
  const res = await fetch(contentsUrl(profile.path));
  if (!res.ok) throw new Error(`AutoEq contents HTTP ${res.status}`);
  const contents = await res.json() as GitHubContent[];
  if (!Array.isArray(contents)) throw new Error('AutoEq profile folder missing');
  const file = contents.find((item) => (
    item.type === 'file'
    && item.name.toLowerCase().endsWith('.txt')
    && item.name.toLowerCase().includes('parametriceq')
    && item.download_url
  ));
  if (!file?.download_url) throw new Error('AutoEq ParametricEQ file missing');
  const textRes = await fetch(file.download_url);
  if (!textRes.ok) throw new Error(`AutoEq raw HTTP ${textRes.status}`);
  return textRes.text();
}
