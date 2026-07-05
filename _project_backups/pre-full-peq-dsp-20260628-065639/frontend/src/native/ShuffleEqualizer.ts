import { NativeModules, Platform } from 'react-native';
import type { EQBand } from '@/src/utils/eq-parser';
import { computeGainAtFrequency } from '@/src/utils/biquad';

type Capabilities = {
  available: boolean;
  centersHz?: number[];
  minDb?: number;
  maxDb?: number;
};

type NativeShuffleEqualizer = {
  getCapabilities(sessionId: number): Promise<Capabilities>;
  applyGains(sessionId: number, enabled: boolean, gainsDb: number[]): Promise<boolean>;
  release(): Promise<boolean>;
};

const FALLBACK_CENTERS = [60, 230, 910, 3600, 14000];
const moduleRef = NativeModules.ShuffleEqualizer as NativeShuffleEqualizer | undefined;

let activeSessionId = 0;
let lastConfig: { enabled: boolean; preamp: number; bands: EQBand[] } = {
  enabled: false,
  preamp: 0,
  bands: [],
};
let cachedCapabilities: Capabilities | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function loadCapabilities(sessionId: number): Promise<Required<Capabilities>> {
  if (cachedCapabilities?.available && cachedCapabilities.centersHz?.length) {
    return {
      available: true,
      centersHz: cachedCapabilities.centersHz,
      minDb: cachedCapabilities.minDb ?? -15,
      maxDb: cachedCapabilities.maxDb ?? 15,
    };
  }
  const caps = moduleRef ? await moduleRef.getCapabilities(sessionId).catch(() => null) : null;
  cachedCapabilities = caps;
  if (caps?.available && caps.centersHz?.length) {
    return {
      available: true,
      centersHz: caps.centersHz,
      minDb: caps.minDb ?? -15,
      maxDb: caps.maxDb ?? 15,
    };
  }
  return { available: false, centersHz: FALLBACK_CENTERS, minDb: -15, maxDb: 15 };
}

export async function syncNativeEq(enabled: boolean, preamp: number, bands: EQBand[]) {
  lastConfig = { enabled, preamp, bands };
  if (Platform.OS !== 'android' || !moduleRef) return false;
  const sessionId = activeSessionId || 0;
  const caps = await loadCapabilities(sessionId);
  const gains = caps.centersHz.map((hz) => clamp(computeGainAtFrequency(bands, preamp, hz), caps.minDb, caps.maxDb));
  return moduleRef.applyGains(sessionId, enabled, gains).catch(() => false);
}

export async function setNativeEqSession(sessionId: number | undefined | null) {
  if (Platform.OS !== 'android' || !moduleRef) return false;
  if (!sessionId || sessionId < 0 || activeSessionId === sessionId) return syncNativeEq(lastConfig.enabled, lastConfig.preamp, lastConfig.bands);
  activeSessionId = sessionId;
  cachedCapabilities = null;
  return syncNativeEq(lastConfig.enabled, lastConfig.preamp, lastConfig.bands);
}
