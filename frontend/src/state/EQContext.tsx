import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type EQBand, type EQConfig, parseEqualizerApo, serializeEqualizerApo, SOUND_PROFILES, createBand,
} from '@/src/utils/eq-parser';
import { getNativeEqStatus, syncNativeEq, type NativeEqStatus } from '@/src/native/ShuffleEqualizer';

export type CustomEQProfile = {
  slot: number;
  name: string;
  preamp: number;
  bands: EQBand[];
  savedAt: number;
};

type EQContextValue = {
  enabled: boolean;
  preamp: number;
  bands: EQBand[];
  loudnessDb: number;
  stereoWidth: number;
  bassBoostDb: number;
  virtualizerStrength: number;
  reverbPreset: number;
  reverbStrength: number;
  selectedPreset: string | null;
  dspStatus: NativeEqStatus;
  customProfiles: CustomEQProfile[];
  setEnabled: (v: boolean) => void;
  setPreamp: (v: number) => void;
  setLoudness: (v: number) => void;
  setStereoWidth: (v: number) => void;
  setBassBoost: (v: number) => void;
  setVirtualizer: (v: number) => void;
  setReverbPreset: (v: number) => void;
  setReverbStrength: (v: number) => void;
  addBand: () => void;
  updateBand: (id: string, patch: Partial<EQBand>) => void;
  removeBand: (id: string) => void;
  applyPreset: (name: string) => void;
  saveCustomProfile: (slot: number, name: string) => void;
  applyCustomProfile: (slot: number) => boolean;
  deleteCustomProfile: (slot: number) => void;
  resetAll: () => void;
  importConfig: (text: string, profileName?: string) => boolean;
  exportConfig: () => string;
};

const EQCtx = createContext<EQContextValue | null>(null);
const STORAGE_KEY = '@shuffleimusic/eq_config_v2';
const CUSTOM_PROFILES_KEY = '@shuffleimusic/custom_eq_profiles_v1';

export function EQProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const [preamp, setPreampState] = useState(0);
  const [bands, setBands] = useState<EQBand[]>([
    createBand({ type: 'LSC', freq: 80, gain: 0, q: 0.71 }),
    createBand({ type: 'PK', freq: 250, gain: 0, q: 1.0 }),
    createBand({ type: 'PK', freq: 1000, gain: 0, q: 1.0 }),
    createBand({ type: 'PK', freq: 4000, gain: 0, q: 1.0 }),
    createBand({ type: 'HSC', freq: 10000, gain: 0, q: 0.71 }),
  ]);
  const [loudnessDb, setLoudnessDb] = useState(0);
  const [stereoWidth, setStereoWidthState] = useState(1.0);
  const [bassBoostDb, setBassBoostDb] = useState(0);
  const [virtualizerStrength, setVirtualizerStrength] = useState(0);
  const [reverbPreset, setReverbPresetState] = useState(-1);
  const [reverbStrength, setReverbStrengthState] = useState(0);

  const [selectedPreset, setSelectedPreset] = useState<string | null>('Flat');
  const [dspStatus, setDspStatus] = useState<NativeEqStatus>({
    status: 'idle',
    message: 'DSP not synced yet',
    lastAppliedAt: 0,
    bandCount: 0,
  });
  const [customProfiles, setCustomProfiles] = useState<CustomEQProfile[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.bands) setBands(parsed.bands);
          if (typeof parsed?.preamp === 'number') setPreampState(parsed.preamp);
          if (typeof parsed?.enabled === 'boolean') setEnabledState(parsed.enabled);
          if (typeof parsed?.loudnessDb === 'number') setLoudnessDb(parsed.loudnessDb);
          if (typeof parsed?.stereoWidth === 'number') setStereoWidthState(parsed.stereoWidth);
          if (typeof parsed?.bassBoostDb === 'number') setBassBoostDb(parsed.bassBoostDb);
          if (typeof parsed?.virtualizerStrength === 'number') setVirtualizerStrength(parsed.virtualizerStrength);
          if (typeof parsed?.reverbPreset === 'number') setReverbPresetState(parsed.reverbPreset);
          if (typeof parsed?.reverbStrength === 'number') setReverbStrengthState(parsed.reverbStrength);
          if (parsed?.selectedPreset) setSelectedPreset(parsed.selectedPreset);
        }
        const customRaw = await AsyncStorage.getItem(CUSTOM_PROFILES_KEY);
        if (customRaw) {
          const parsed = JSON.parse(customRaw);
          if (Array.isArray(parsed)) {
            setCustomProfiles(parsed.filter((p) => p?.slot >= 1 && p?.slot <= 5 && Array.isArray(p?.bands)));
          }
        }
      } catch {
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled, preamp, bands, selectedPreset, loudnessDb, stereoWidth, bassBoostDb, virtualizerStrength, reverbPreset, reverbStrength,
    })).catch(() => {});
  }, [enabled, hydrated, preamp, bands, selectedPreset, loudnessDb, stereoWidth, bassBoostDb, virtualizerStrength, reverbPreset, reverbStrength]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles)).catch(() => {});
  }, [customProfiles, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let canceled = false;
    import('@/src/native/ShuffleEqualizer').then(({ syncNativeAudioEffects }) => {
      syncNativeAudioEffects({
        enabled,
        preamp,
        bands,
        loudnessDb,
        stereoWidth,
        bassBoostDb,
        virtualizerStrength,
        reverbPreset,
      })
        .then((status) => { if (!canceled) setDspStatus(status); })
        .catch((e) => {
          if (!canceled) {
            setDspStatus({
              status: 'unavailable',
              message: e instanceof Error ? e.message : 'Native effects sync failed',
              lastAppliedAt: Date.now(),
              bandCount: 0,
            });
          }
        });
    });
    return () => { canceled = true; };
  }, [enabled, hydrated, preamp, bands, loudnessDb, stereoWidth, bassBoostDb, virtualizerStrength, reverbPreset, reverbStrength]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      getNativeEqStatus()
        .then(setDspStatus)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  const setEnabled = useCallback((v: boolean) => setEnabledState(v), []);
  const setPreamp = useCallback((v: number) => { setPreampState(v); setSelectedPreset(null); }, []);
  const setLoudness = useCallback((v: number) => setLoudnessDb(v), []);
  const setStereoWidth = useCallback((v: number) => setStereoWidthState(v), []);
  const setBassBoost = useCallback((v: number) => setBassBoostDb(v), []);
  const setVirtualizer = useCallback((v: number) => setVirtualizerStrength(v), []);
  const setReverbPreset = useCallback((v: number) => setReverbPresetState(v), []);
  const setReverbStrength = useCallback((v: number) => setReverbStrengthState(v), []);

  const addBand = useCallback(() => {
    setBands((b) => [...b, createBand({ freq: 1000, gain: 0, q: 1.0 })]);
    setSelectedPreset(null);
  }, []);

  const updateBand = useCallback((id: string, patch: Partial<EQBand>) => {
    setBands((b) => b.map((x) => x.id === id ? { ...x, ...patch } : x));
    setSelectedPreset(null);
  }, []);

  const removeBand = useCallback((id: string) => {
    setBands((b) => b.filter((x) => x.id !== id));
    setSelectedPreset(null);
  }, []);

  const applyPreset = useCallback((name: string) => {
    const p = SOUND_PROFILES.find((x) => x.name === name);
    if (!p) return;
    setPreampState(p.config.preamp);
    setBands(p.config.bands.length ? p.config.bands.map((b) => createBand(b)) : [
      createBand({ type: 'LSC', freq: 80, gain: 0, q: 0.71 }),
      createBand({ type: 'PK', freq: 250, gain: 0, q: 1.0 }),
      createBand({ type: 'PK', freq: 1000, gain: 0, q: 1.0 }),
      createBand({ type: 'PK', freq: 4000, gain: 0, q: 1.0 }),
      createBand({ type: 'HSC', freq: 10000, gain: 0, q: 0.71 }),
    ]);
    setLoudnessDb(p.loudnessDb);
    setStereoWidthState(p.stereoWidth);
    setBassBoostDb(p.bassBoostDb);
    setVirtualizerStrength(p.virtualizerStrength);
    setReverbPresetState(p.reverbPreset);
    setReverbStrengthState(p.reverbStrength);
    setSelectedPreset(name);
  }, []);

  const saveCustomProfile = useCallback((slot: number, name: string) => {
    if (slot < 1 || slot > 5) return;
    const profile: CustomEQProfile = {
      slot,
      name: (name || `Custom ${slot}`).trim(),
      preamp,
      bands: bands.map((b) => ({ ...b })),
      savedAt: Date.now(),
    };
    setCustomProfiles((list) => [
      ...list.filter((p) => p.slot !== slot),
      profile,
    ].sort((a, b) => a.slot - b.slot));
  }, [bands, preamp]);

  const applyCustomProfile = useCallback((slot: number): boolean => {
    const profile = customProfiles.find((p) => p.slot === slot);
    if (!profile) return false;
    setPreampState(profile.preamp);
    setBands(profile.bands.map((b) => createBand(b)));
    setSelectedPreset(profile.name);
    return true;
  }, [customProfiles]);

  const deleteCustomProfile = useCallback((slot: number) => {
    setCustomProfiles((list) => list.filter((p) => p.slot !== slot));
  }, []);

  const resetAll = useCallback(() => {
    applyPreset('Flat');
    setLoudnessDb(0);
    setStereoWidthState(1.0);
    setBassBoostDb(0);
    setVirtualizerStrength(0);
    setReverbPresetState(-1);
    setReverbStrengthState(0);
  }, [applyPreset]);

  const importConfig = useCallback((text: string, profileName?: string): boolean => {
    try {
      const cfg = parseEqualizerApo(text);
      setPreampState(cfg.preamp);
      setBands(cfg.bands.length ? cfg.bands : []);
      setSelectedPreset(profileName?.trim() || null);
      return true;
    } catch {
      return false;
    }
  }, []);

  const exportConfig = useCallback((): string => {
    const cfg: EQConfig = { preamp, bands };
    return serializeEqualizerApo(cfg);
  }, [preamp, bands]);

  const value = useMemo(() => ({
    enabled, preamp, bands, loudnessDb, stereoWidth, bassBoostDb, virtualizerStrength, reverbPreset, reverbStrength, selectedPreset, dspStatus, customProfiles,
    setEnabled, setPreamp, setLoudness, setStereoWidth, setBassBoost, setVirtualizer, setReverbPreset, setReverbStrength,
    addBand, updateBand, removeBand,
    applyPreset, saveCustomProfile, applyCustomProfile, deleteCustomProfile, resetAll, importConfig, exportConfig,
  }), [enabled, preamp, bands, loudnessDb, stereoWidth, bassBoostDb, virtualizerStrength, reverbPreset, reverbStrength, selectedPreset, dspStatus, customProfiles,
       setEnabled, setPreamp, setLoudness, setStereoWidth, setBassBoost, setVirtualizer, setReverbPreset, setReverbStrength,
       addBand, updateBand, removeBand,
       applyPreset, saveCustomProfile, applyCustomProfile, deleteCustomProfile, resetAll, importConfig, exportConfig]);

  return <EQCtx.Provider value={value}>{children}</EQCtx.Provider>;
}

export function useEQ() {
  const ctx = useContext(EQCtx);
  if (!ctx) throw new Error('useEQ outside EQProvider');
  return ctx;
}
