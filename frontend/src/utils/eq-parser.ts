// EqualizerAPO config file parser & serializer
// Format examples:
//   Preamp: -6.0 dB
//   Filter 1: ON PK Fc 100 Hz Gain -3 dB Q 1.0
//   Filter 2: ON HSC Fc 8000 Hz Gain 2 dB Q 0.71
//   Filter 3: ON LSC Fc 80 Hz Gain 4 dB Q 0.7

export type FilterType = 'PK' | 'LSC' | 'HSC' | 'LP' | 'HP' | 'NO' | 'AP' | 'BP';

export const FILTER_TYPE_LABEL: Record<FilterType, string> = {
  PK: 'Peak',
  LSC: 'Low Shelf',
  HSC: 'High Shelf',
  LP: 'Low Pass',
  HP: 'High Pass',
  NO: 'Notch',
  AP: 'All Pass',
  BP: 'Band Pass',
};

export type EQBand = {
  id: string;
  enabled: boolean;
  type: FilterType;
  freq: number; // Hz
  gain: number; // dB
  q: number;
};

export type EQConfig = {
  preamp: number; // dB
  bands: EQBand[];
};

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

export function parseEqualizerApo(text: string): EQConfig {
  const lines = text.split(/\r?\n/);
  const bands: EQBand[] = [];
  let preamp = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const preampMatch = line.match(/^Preamp:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
    if (preampMatch) {
      preamp = parseFloat(preampMatch[1]);
      continue;
    }

    const filterMatch = line.match(
      /^Filter\s*\d+\s*:\s*(ON|OFF)\s+(PK|LSC|HSC|LP|HP|NO|AP|BP)\s+Fc\s+(-?\d+(?:\.\d+)?)\s*Hz(?:\s+Gain\s+(-?\d+(?:\.\d+)?)\s*dB)?(?:\s+Q\s+(-?\d+(?:\.\d+)?))?/i,
    );
    if (filterMatch) {
      bands.push({
        id: uid(),
        enabled: filterMatch[1].toUpperCase() === 'ON',
        type: filterMatch[2].toUpperCase() as FilterType,
        freq: parseFloat(filterMatch[3]),
        gain: filterMatch[4] != null ? parseFloat(filterMatch[4]) : 0,
        q: filterMatch[5] != null ? parseFloat(filterMatch[5]) : 0.707,
      });
    }
  }
  return { preamp, bands };
}

function peqFilterType(filter: unknown): FilterType {
  // PEQ-AutoEQ uses numeric HiBy-style filter ids: 0 low shelf, 1 peak, 2 high shelf.
  if (filter === 0 || filter === '0') return 'LSC';
  if (filter === 2 || filter === '2') return 'HSC';
  return 'PK';
}

export function parsePeqAutoEq(text: string): EQConfig {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.bands)) throw new Error('Invalid PEQ bands');
  return {
    preamp: typeof parsed.pre_amp === 'number' ? parsed.pre_amp : 0,
    bands: parsed.bands.map((b: any) => createBand({
      enabled: b?.on !== 0,
      type: peqFilterType(b?.filter),
      freq: Number(b?.freq) || 1000,
      gain: Number(b?.gain) || 0,
      q: Number(b?.q) || 0.707,
    })),
  };
}

export function peqAutoEqToEqualizerApo(text: string): string {
  return serializeEqualizerApo(parsePeqAutoEq(text));
}

export function serializeEqualizerApo(config: EQConfig): string {
  const lines: string[] = [];
  lines.push(`# ChromeAmp Parametric EQ export`);
  lines.push(`Preamp: ${config.preamp.toFixed(1)} dB`);
  config.bands.forEach((b, i) => {
    lines.push(
      `Filter ${i + 1}: ${b.enabled ? 'ON' : 'OFF'} ${b.type} Fc ${b.freq.toFixed(0)} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.q.toFixed(3)}`,
    );
  });
  return lines.join('\n');
}

export function defaultBand(): EQBand {
  return { id: uid(), enabled: true, type: 'PK', freq: 1000, gain: 0, q: 1.0 };
}

export function createBand(part: Partial<EQBand>): EQBand {
  return { ...defaultBand(), ...part, id: part.id ?? uid() };
}

// Sound profile with audio effects parameters
export type SoundProfile = {
  name: string;
  brand: string;
  config: EQConfig;
  bassBoostDb: number;
  virtualizerStrength: number;
  reverbPreset: number;
  reverbStrength: number;
  loudnessDb: number;
  stereoWidth: number;
};

export const REVERB_PRESETS = [
  { name: 'None', value: -1 },
  { name: 'Small Room', value: 0 },
  { name: 'Medium Room', value: 1 },
  { name: 'Large Room', value: 2 },
  { name: 'Medium Hall', value: 3 },
  { name: 'Large Hall', value: 4 },
  { name: 'Plate', value: 5 },
];

// Built-in sound profiles with audio effects
export const SOUND_PROFILES: SoundProfile[] = [
  {
    name: 'Flat',
    brand: 'Reference',
    config: { preamp: 0, bands: [] },
    bassBoostDb: 0, virtualizerStrength: 0, reverbPreset: -1, reverbStrength: 0, loudnessDb: 0, stereoWidth: 1.0,
  },
  {
    name: 'Bass Boost',
    brand: 'FX',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 80, gain: 6, q: 0.71 }),
        createBand({ type: 'PK', freq: 200, gain: 3, q: 1.0 }),
      ],
    },
    bassBoostDb: 6, virtualizerStrength: 0, reverbPreset: -1, reverbStrength: 0, loudnessDb: 2, stereoWidth: 1.0,
  },
  {
    name: 'Vocal',
    brand: 'FX',
    config: {
      preamp: -2,
      bands: [
        createBand({ type: 'PK', freq: 250, gain: -2, q: 1.0 }),
        createBand({ type: 'PK', freq: 2500, gain: 4, q: 1.0 }),
        createBand({ type: 'HSC', freq: 8000, gain: 2, q: 0.71 }),
      ],
    },
    bassBoostDb: 0, virtualizerStrength: 0, reverbPreset: -1, reverbStrength: 0, loudnessDb: 3, stereoWidth: 1.0,
  },
  {
    name: 'Rock',
    brand: 'FX',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 60, gain: 4, q: 0.7 }),
        createBand({ type: 'PK', freq: 250, gain: -2, q: 1.0 }),
        createBand({ type: 'PK', freq: 3500, gain: 3, q: 1.0 }),
        createBand({ type: 'HSC', freq: 10000, gain: 3, q: 0.71 }),
      ],
    },
    bassBoostDb: 3, virtualizerStrength: 20, reverbPreset: 1, reverbStrength: 150, loudnessDb: 2, stereoWidth: 1.2,
  },
  {
    name: 'Classical',
    brand: 'FX',
    config: {
      preamp: -1,
      bands: [
        createBand({ type: 'PK', freq: 100, gain: 2, q: 0.8 }),
        createBand({ type: 'PK', freq: 1000, gain: -1, q: 1.0 }),
        createBand({ type: 'HSC', freq: 8000, gain: 3, q: 0.71 }),
      ],
    },
    bassBoostDb: 0, virtualizerStrength: 40, reverbPreset: 4, reverbStrength: 300, loudnessDb: 1, stereoWidth: 1.3,
  },
  {
    name: 'Electronic',
    brand: 'FX',
    config: {
      preamp: -4,
      bands: [
        createBand({ type: 'LSC', freq: 60, gain: 5, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: 2, q: 1.0 }),
        createBand({ type: 'PK', freq: 5000, gain: 2, q: 1.0 }),
        createBand({ type: 'HSC', freq: 12000, gain: 4, q: 0.71 }),
      ],
    },
    bassBoostDb: 5, virtualizerStrength: 30, reverbPreset: 2, reverbStrength: 200, loudnessDb: 3, stereoWidth: 1.4,
  },
  {
    name: 'Atmos',
    brand: 'Dolby',
    config: {
      preamp: -4,
      bands: [
        createBand({ type: 'LSC', freq: 50, gain: 3.5, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: -1, q: 1.0 }),
        createBand({ type: 'PK', freq: 3000, gain: 2.5, q: 0.8 }),
        createBand({ type: 'PK', freq: 6000, gain: 3.0, q: 1.0 }),
        createBand({ type: 'HSC', freq: 12000, gain: 4.5, q: 0.7 }),
      ],
    },
    bassBoostDb: 5, virtualizerStrength: 80, reverbPreset: 4, reverbStrength: 300, loudnessDb: 2, stereoWidth: 1.5,
  },
  {
    name: 'Cinema',
    brand: 'Dolby',
    config: {
      preamp: -5,
      bands: [
        createBand({ type: 'LSC', freq: 40, gain: 5.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 150, gain: -1, q: 1.2 }),
        createBand({ type: 'PK', freq: 2000, gain: 2.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 6000, gain: 3.5, q: 0.9 }),
        createBand({ type: 'HSC', freq: 14000, gain: 4.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 6, virtualizerStrength: 90, reverbPreset: 4, reverbStrength: 500, loudnessDb: 3, stereoWidth: 1.8,
  },
  {
    name: 'Signature',
    brand: 'JBL',
    config: {
      preamp: -5,
      bands: [
        createBand({ type: 'LSC', freq: 65, gain: 6.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 250, gain: 2.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 5000, gain: 3.0, q: 1.2 }),
        createBand({ type: 'HSC', freq: 10000, gain: 4.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 8, virtualizerStrength: 40, reverbPreset: 1, reverbStrength: 200, loudnessDb: 4, stereoWidth: 1.3,
  },
  {
    name: 'Quantum',
    brand: 'JBL',
    config: {
      preamp: -4,
      bands: [
        createBand({ type: 'LSC', freq: 55, gain: 5.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: 1.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 3000, gain: 3.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 8000, gain: 4.0, q: 1.2 }),
        createBand({ type: 'HSC', freq: 12000, gain: 3.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 5, virtualizerStrength: 70, reverbPreset: 0, reverbStrength: 150, loudnessDb: 2, stereoWidth: 1.6,
  },
  {
    name: 'Hi-Res',
    brand: 'Sony',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 40, gain: 4.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 150, gain: 1.5, q: 1.0 }),
        createBand({ type: 'PK', freq: 4000, gain: 2.0, q: 1.0 }),
        createBand({ type: 'HSC', freq: 15000, gain: 3.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 2, virtualizerStrength: 30, reverbPreset: 0, reverbStrength: 100, loudnessDb: 1, stereoWidth: 1.1,
  },
  {
    name: '360 Reality',
    brand: 'Sony',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 45, gain: 3.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: 1.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 2500, gain: 2.5, q: 0.8 }),
        createBand({ type: 'PK', freq: 8000, gain: 2.0, q: 1.0 }),
        createBand({ type: 'HSC', freq: 16000, gain: 2.5, q: 0.7 }),
      ],
    },
    bassBoostDb: 4, virtualizerStrength: 95, reverbPreset: 4, reverbStrength: 400, loudnessDb: 2, stereoWidth: 2.0,
  },
  {
    name: 'Signature',
    brand: 'Bose',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'PK', freq: 80, gain: 3.0, q: 0.8 }),
        createBand({ type: 'PK', freq: 400, gain: 2.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 2000, gain: 3.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 6000, gain: 2.0, q: 1.0 }),
        createBand({ type: 'HSC', freq: 12000, gain: 2.5, q: 0.7 }),
      ],
    },
    bassBoostDb: 5, virtualizerStrength: 40, reverbPreset: 1, reverbStrength: 200, loudnessDb: 3, stereoWidth: 1.25,
  },
  {
    name: 'HD Studio',
    brand: 'Sennheiser',
    config: {
      preamp: -1,
      bands: [
        createBand({ type: 'PK', freq: 100, gain: 1.0, q: 0.8 }),
        createBand({ type: 'PK', freq: 1000, gain: 1.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 4000, gain: 1.0, q: 1.0 }),
        createBand({ type: 'HSC', freq: 10000, gain: 1.5, q: 0.7 }),
      ],
    },
    bassBoostDb: 1, virtualizerStrength: 20, reverbPreset: -1, reverbStrength: 0, loudnessDb: 1, stereoWidth: 1.0,
  },
  {
    name: 'Signature',
    brand: 'Bang & Olufsen',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 50, gain: 4.0, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: 2.5, q: 1.0 }),
        createBand({ type: 'PK', freq: 1500, gain: 2.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 5000, gain: 2.5, q: 1.0 }),
        createBand({ type: 'HSC', freq: 12000, gain: 2.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 4, virtualizerStrength: 45, reverbPreset: 3, reverbStrength: 300, loudnessDb: 2, stereoWidth: 1.35,
  },
  {
    name: 'Signature',
    brand: 'Harman Kardon',
    config: {
      preamp: -2,
      bands: [
        createBand({ type: 'PK', freq: 80, gain: 2.0, q: 0.8 }),
        createBand({ type: 'PK', freq: 500, gain: 3.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 2000, gain: 2.0, q: 1.0 }),
        createBand({ type: 'PK', freq: 8000, gain: 1.5, q: 1.0 }),
        createBand({ type: 'HSC', freq: 14000, gain: 2.0, q: 0.7 }),
      ],
    },
    bassBoostDb: 3, virtualizerStrength: 35, reverbPreset: 1, reverbStrength: 250, loudnessDb: 2, stereoWidth: 1.2,
  },
];

// Legacy flat presets list for backward compat
export const PRESETS: { name: string; config: EQConfig }[] = SOUND_PROFILES.map((p) => ({
  name: p.name,
  config: p.config,
}));

// Group profiles by brand
export function getBrandSections() {
  const brands = new Map<string, SoundProfile[]>();
  for (const p of SOUND_PROFILES) {
    if (!brands.has(p.brand)) brands.set(p.brand, []);
    brands.get(p.brand)!.push(p);
  }
  return Array.from(brands.entries()).map(([brand, profiles]) => ({ brand, profiles }));
}
