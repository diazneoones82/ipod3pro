export type TrackLookupInput = {
  filename: string;
  title?: string;
  artist?: string;
  contributingArtist?: string;
  album?: string;
  duration?: number;
};

function useful(value?: string | null) {
  const text = String(value || '').trim();
  if (!text || /^(unknown|<unknown>|null|undefined)$/i.test(text)) return '';
  return text;
}

export function cleanToken(text: string) {
  return text
    .replace(/\.[^.]+$/, '')
    .replace(/\[[^\]]*]|\([^)]*\)/g, ' ')
    .replace(/\b(official|audio|video|lyrics?|lyric video|remaster(?:ed)?|radio edit|explicit|clean)\b/gi, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function trackLookupParts(track: TrackLookupInput) {
  const fallback = cleanToken(track.filename);
  const title = cleanToken(useful(track.title) || fallback);
  const parsed = fallback.split(/\s+-\s+|\s+–\s+|\s+—\s+/).map((p) => p.trim()).filter(Boolean);
  const parsedArtist = parsed.length >= 2 ? parsed[0] : '';
  const parsedTitle = parsed.length >= 2 ? parsed.slice(1).join(' - ') : title;
  return {
    title: title || parsedTitle,
    artist: useful(track.contributingArtist) || useful(track.artist) || parsedArtist || undefined,
    album: useful(track.album) || undefined,
    duration: track.duration,
  };
}

export function safeFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'art';
}
