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

// Built-in presets
export const PRESETS: { name: string; config: EQConfig }[] = [
  {
    name: 'Flat',
    config: { preamp: 0, bands: [] },
  },
  {
    name: 'Bass Boost',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 80, gain: 6, q: 0.71 }),
        createBand({ type: 'PK', freq: 200, gain: 3, q: 1.0 }),
      ],
    },
  },
  {
    name: 'Vocal',
    config: {
      preamp: -2,
      bands: [
        createBand({ type: 'PK', freq: 250, gain: -2, q: 1.0 }),
        createBand({ type: 'PK', freq: 2500, gain: 4, q: 1.0 }),
        createBand({ type: 'HSC', freq: 8000, gain: 2, q: 0.71 }),
      ],
    },
  },
  {
    name: 'Rock',
    config: {
      preamp: -3,
      bands: [
        createBand({ type: 'LSC', freq: 60, gain: 4, q: 0.7 }),
        createBand({ type: 'PK', freq: 250, gain: -2, q: 1.0 }),
        createBand({ type: 'PK', freq: 3500, gain: 3, q: 1.0 }),
        createBand({ type: 'HSC', freq: 10000, gain: 3, q: 0.71 }),
      ],
    },
  },
  {
    name: 'Classical',
    config: {
      preamp: -1,
      bands: [
        createBand({ type: 'PK', freq: 100, gain: 2, q: 0.8 }),
        createBand({ type: 'PK', freq: 1000, gain: -1, q: 1.0 }),
        createBand({ type: 'HSC', freq: 8000, gain: 3, q: 0.71 }),
      ],
    },
  },
  {
    name: 'Electronic',
    config: {
      preamp: -4,
      bands: [
        createBand({ type: 'LSC', freq: 60, gain: 5, q: 0.7 }),
        createBand({ type: 'PK', freq: 200, gain: 2, q: 1.0 }),
        createBand({ type: 'PK', freq: 5000, gain: 2, q: 1.0 }),
        createBand({ type: 'HSC', freq: 12000, gain: 4, q: 0.71 }),
      ],
    },
  },
];
