import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type EQBand, type EQConfig, parseEqualizerApo, serializeEqualizerApo, PRESETS, createBand,
} from '@/src/utils/eq-parser';

type EQContextValue = {
  enabled: boolean;
  preamp: number;
  bands: EQBand[];
  selectedPreset: string | null;
  setEnabled: (v: boolean) => void;
  setPreamp: (v: number) => void;
  addBand: () => void;
  updateBand: (id: string, patch: Partial<EQBand>) => void;
  removeBand: (id: string) => void;
  applyPreset: (name: string) => void;
  resetAll: () => void;
  importConfig: (text: string) => boolean;
  exportConfig: () => string;
};

const EQCtx = createContext<EQContextValue | null>(null);
const STORAGE_KEY = '@shuffleimusic/eq_config_v1';

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
  const [selectedPreset, setSelectedPreset] = useState<string | null>('Flat');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.bands) setBands(parsed.bands);
        if (typeof parsed?.preamp === 'number') setPreampState(parsed.preamp);
        if (typeof parsed?.enabled === 'boolean') setEnabledState(parsed.enabled);
        if (parsed?.selectedPreset) setSelectedPreset(parsed.selectedPreset);
      } catch {}
    })();
  }, []);

  // Persist
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled, preamp, bands, selectedPreset,
    })).catch(() => {});
  }, [enabled, preamp, bands, selectedPreset]);

  const setEnabled = useCallback((v: boolean) => setEnabledState(v), []);
  const setPreamp = useCallback((v: number) => { setPreampState(v); setSelectedPreset(null); }, []);

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
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    // Recreate bands with new ids so React keys are stable
    setPreampState(p.config.preamp);
    setBands(p.config.bands.length ? p.config.bands.map((b) => createBand(b)) : [
      createBand({ type: 'LSC', freq: 80, gain: 0, q: 0.71 }),
      createBand({ type: 'PK', freq: 250, gain: 0, q: 1.0 }),
      createBand({ type: 'PK', freq: 1000, gain: 0, q: 1.0 }),
      createBand({ type: 'PK', freq: 4000, gain: 0, q: 1.0 }),
      createBand({ type: 'HSC', freq: 10000, gain: 0, q: 0.71 }),
    ]);
    setSelectedPreset(name);
  }, []);

  const resetAll = useCallback(() => applyPreset('Flat'), [applyPreset]);

  const importConfig = useCallback((text: string): boolean => {
    try {
      const cfg = parseEqualizerApo(text);
      setPreampState(cfg.preamp);
      setBands(cfg.bands.length ? cfg.bands : []);
      setSelectedPreset(null);
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
    enabled, preamp, bands, selectedPreset,
    setEnabled, setPreamp, addBand, updateBand, removeBand,
    applyPreset, resetAll, importConfig, exportConfig,
  }), [enabled, preamp, bands, selectedPreset,
       setEnabled, setPreamp, addBand, updateBand, removeBand,
       applyPreset, resetAll, importConfig, exportConfig]);

  return <EQCtx.Provider value={value}>{children}</EQCtx.Provider>;
}

export function useEQ() {
  const ctx = useContext(EQCtx);
  if (!ctx) throw new Error('useEQ outside EQProvider');
  return ctx;
}
