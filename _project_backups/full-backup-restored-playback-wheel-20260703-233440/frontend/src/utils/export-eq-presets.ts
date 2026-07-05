import * as FileSystem from 'expo-file-system/legacy';

import { listAutoEqProfiles, resolveAutoEqParametricConfig } from '@/src/utils/autoeq';
import { listPeqAutoEqProfiles } from '@/src/utils/peq-autoeq';

export type EqPresetExportProgress = {
  phase: 'selecting' | 'loading' | 'peq' | 'autoeq' | 'manifest' | 'done';
  current: number;
  total: number;
  message: string;
};

export type EqPresetExportResult = {
  rootUri: string;
  peqSaved: number;
  autoEqSaved: number;
  failed: number;
};

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeName(value: string, fallback: string) {
  return (value || fallback)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._ -]+/gi, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || fallback;
}

async function writeTextFile(parentUri: string, name: string, text: string, mimeType = 'text/plain') {
  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(parentUri, name, mimeType);
  await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, text);
  return fileUri;
}

export async function exportDiscoveredEqPresets(
  onProgress?: (progress: EqPresetExportProgress) => void,
): Promise<EqPresetExportResult | null> {
  onProgress?.({ phase: 'selecting', current: 0, total: 0, message: 'Choose export folder' });
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) return null;

  const rootUri = await FileSystem.StorageAccessFramework.makeDirectoryAsync(
    permissions.directoryUri,
    `ShuffleMuSic_EQ_${stamp()}`,
  );
  const peqDir = await FileSystem.StorageAccessFramework.makeDirectoryAsync(rootUri, 'PEQ-AutoEQ');
  const autoEqDir = await FileSystem.StorageAccessFramework.makeDirectoryAsync(rootUri, 'AutoEq');

  onProgress?.({ phase: 'loading', current: 0, total: 0, message: 'Loading preset catalogs' });
  const [peqProfiles, autoEqProfiles] = await Promise.all([
    listPeqAutoEqProfiles(),
    listAutoEqProfiles(),
  ]);
  const total = peqProfiles.length + autoEqProfiles.length;
  let current = 0;
  let peqSaved = 0;
  let autoEqSaved = 0;
  let failed = 0;
  const failures: { source: string; name: string; error: string }[] = [];

  for (const profile of peqProfiles) {
    current += 1;
    onProgress?.({ phase: 'peq', current, total, message: `PEQ-AutoEQ: ${profile.name}` });
    try {
      const res = await fetch(profile.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await writeTextFile(peqDir, `${String(current).padStart(5, '0')}_${safeName(`${profile.source}_${profile.kind}_${profile.name}`, `peq_${current}`)}.peq`, text);
      peqSaved += 1;
    } catch (e) {
      failed += 1;
      failures.push({ source: 'PEQ-AutoEQ', name: profile.name, error: e instanceof Error ? e.message : 'download failed' });
    }
  }

  for (const profile of autoEqProfiles) {
    current += 1;
    onProgress?.({ phase: 'autoeq', current, total, message: `AutoEq: ${profile.name}` });
    try {
      const text = await resolveAutoEqParametricConfig(profile);
      await writeTextFile(autoEqDir, `${String(current).padStart(5, '0')}_${safeName(`${profile.source}_${profile.measurement}_${profile.name}`, `autoeq_${current}`)}.txt`, text);
      autoEqSaved += 1;
    } catch (e) {
      failed += 1;
      failures.push({ source: 'AutoEq', name: profile.name, error: e instanceof Error ? e.message : 'download failed' });
    }
  }

  onProgress?.({ phase: 'manifest', current: total, total, message: 'Writing manifest' });
  await writeTextFile(rootUri, 'manifest.json', JSON.stringify({
    app: 'Shuffle MuSic',
    exportedAt: new Date().toISOString(),
    peqAutoEq: { count: peqSaved },
    autoEq: { count: autoEqSaved },
    failed,
    failures,
  }, null, 2), 'application/json');

  onProgress?.({ phase: 'done', current: total, total, message: 'Export complete' });
  return { rootUri, peqSaved, autoEqSaved, failed };
}
