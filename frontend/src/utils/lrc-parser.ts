export type LrcEntry = {
  time: number;
  text: string;
};

export type LrcParseResult = {
  entries: LrcEntry[];
  offset: number;
  isSynced: boolean;
};

const LINE_RE = /^\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)$/;
const OFFSET_RE = /^\[offset:\s*(-?\d+)\]$/;

function parseTs(mm: string, ss: string, ms: string): number {
  const mins = parseInt(mm, 10);
  const secs = parseInt(ss, 10);
  let millis = parseInt(ms, 10);
  if (ms.length === 2) millis *= 10;
  return mins * 60000 + secs * 1000 + millis;
}

export function parseLrc(text: string): LrcParseResult {
  const lines = text.split('\n');
  const entries: LrcEntry[] = [];
  let offset = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const offMatch = line.match(OFFSET_RE);
    if (offMatch) {
      offset = parseInt(offMatch[1], 10);
      continue;
    }
    const m = line.match(LINE_RE);
    if (m) {
      const time = parseTs(m[1], m[2], m[3]);
      const text = m[4].trim();
      if (text) entries.push({ time, text });
    }
  }

  entries.sort((a, b) => a.time - b.time);

  return { entries, offset, isSynced: entries.length > 0 };
}

export function findLineIndex(entries: LrcEntry[], timeMs: number, offset = 0): number {
  if (entries.length === 0) return -1;
  const adj = timeMs + offset;
  let lo = 0;
  let hi = entries.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].time <= adj) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export function formatLrcTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
