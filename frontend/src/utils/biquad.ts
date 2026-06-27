// Biquad filter math for frequency response visualization
// Reference: Robert Bristow-Johnson's Audio EQ Cookbook
import type { EQBand } from './eq-parser';

const SAMPLE_RATE = 48000;

type Coeffs = { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number };

function biquadCoeffs(band: EQBand): Coeffs {
  const A = Math.pow(10, band.gain / 40);
  const w0 = (2 * Math.PI * band.freq) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.max(0.01, band.q);
  const alpha = sin / (2 * Q);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (band.type) {
    case 'PK': {
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
    case 'LSC': {
      const sqrtA = Math.sqrt(A);
      b0 = A * (A + 1 - (A - 1) * cos + 2 * sqrtA * alpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - 2 * sqrtA * alpha);
      a0 = A + 1 + (A - 1) * cos + 2 * sqrtA * alpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - 2 * sqrtA * alpha;
      break;
    }
    case 'HSC': {
      const sqrtA = Math.sqrt(A);
      b0 = A * (A + 1 + (A - 1) * cos + 2 * sqrtA * alpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - 2 * sqrtA * alpha);
      a0 = A + 1 - (A - 1) * cos + 2 * sqrtA * alpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - 2 * sqrtA * alpha;
      break;
    }
    case 'LP': {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'HP': {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'NO': {
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'BP': {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'AP': {
      b0 = 1 - alpha;
      b1 = -2 * cos;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
  }
  return { b0, b1, b2, a0, a1, a2 };
}

// Magnitude response in dB at angular freq w (radians/sample)
function bandMagDb(coeffs: Coeffs, w: number): number {
  const { b0, b1, b2, a0, a1, a2 } = coeffs;
  const cosW = Math.cos(w), cos2W = Math.cos(2 * w);
  const sinW = Math.sin(w), sin2W = Math.sin(2 * w);
  const numRe = b0 + b1 * cosW + b2 * cos2W;
  const numIm = -(b1 * sinW + b2 * sin2W);
  const denRe = a0 + a1 * cosW + a2 * cos2W;
  const denIm = -(a1 * sinW + a2 * sin2W);
  const numMag2 = numRe * numRe + numIm * numIm;
  const denMag2 = denRe * denRe + denIm * denIm;
  if (denMag2 === 0) return 0;
  return 10 * Math.log10(numMag2 / denMag2);
}

// Returns array of {hz, db} for plotting; default log scale 20Hz-20kHz
export function computeFrequencyResponse(
  bands: EQBand[],
  preamp: number,
  points = 96,
): { hz: number; db: number }[] {
  const fMin = 20;
  const fMax = 20000;
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  const result: { hz: number; db: number }[] = [];

  const enabledCoeffs = bands.filter((b) => b.enabled).map(biquadCoeffs);

  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const hz = Math.pow(10, logMin + t * (logMax - logMin));
    const w = (2 * Math.PI * hz) / SAMPLE_RATE;
    let db = preamp;
    for (const c of enabledCoeffs) db += bandMagDb(c, w);
    result.push({ hz, db });
  }
  return result;
}
