from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone
import asyncio
import base64
from functools import lru_cache
import hashlib
import hmac
import re
import time
import urllib.parse
import requests
from difflib import SequenceMatcher


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# --- Existing status (kept) ---
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    obj = StatusCheck(**input.dict())
    doc = obj.dict()
    await db.status_checks.insert_one(doc)
    return obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    items = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    return [StatusCheck(**x) for x in items]


# --- EQ Profiles (Discover) ---
FilterType = Literal['PK', 'LSC', 'HSC', 'LP', 'HP', 'NO', 'AP', 'BP']


class EQBandModel(BaseModel):
    enabled: bool = True
    type: FilterType
    freq: float
    gain: float = 0.0
    q: float = 1.0


class EQProfileCreate(BaseModel):
    name: str
    author: str
    description: str = ""
    tags: List[str] = []
    preamp: float = 0.0
    bands: List[EQBandModel] = []


class EQProfileOut(EQProfileCreate):
    id: str
    stars: int = 0
    downloads: int = 0
    starred: bool = False  # whether the calling user starred it
    created_at: str


def _profile_to_out(doc: dict, user_id: Optional[str]) -> EQProfileOut:
    starred_by = doc.get("starred_by") or []
    return EQProfileOut(
        id=doc["id"],
        name=doc["name"],
        author=doc["author"],
        description=doc.get("description", ""),
        tags=doc.get("tags", []),
        preamp=doc.get("preamp", 0.0),
        bands=doc.get("bands", []),
        stars=len(starred_by),
        downloads=doc.get("downloads", 0),
        starred=(user_id in starred_by) if user_id else False,
        created_at=doc.get("created_at", ""),
    )


@api_router.get("/eq-profiles", response_model=List[EQProfileOut])
async def list_profiles(
    sort: str = Query("trending"),
    q: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 50,
):
    query: dict = {}
    if q:
        regex = {"$regex": q, "$options": "i"}
        query = {"$or": [{"name": regex}, {"tags": regex}, {"author": regex}]}
    cursor = db.eq_profiles.find(query, {"_id": 0})
    if sort == "new":
        cursor = cursor.sort("created_at", -1)
    elif sort == "stars":
        # mongo can't sort by computed; sort by len(starred_by) approx via pre-stored star_count
        cursor = cursor.sort([("star_count", -1), ("created_at", -1)])
    else:  # trending = stars * 2 + downloads
        cursor = cursor.sort([("star_count", -1), ("downloads", -1), ("created_at", -1)])
    items = await cursor.to_list(limit)
    return [_profile_to_out(d, user_id) for d in items]


@api_router.get("/eq-profiles/{profile_id}", response_model=EQProfileOut)
async def get_profile(profile_id: str, user_id: Optional[str] = None):
    doc = await db.eq_profiles.find_one({"id": profile_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _profile_to_out(doc, user_id)


@api_router.post("/eq-profiles", response_model=EQProfileOut)
async def create_profile(payload: EQProfileCreate, user_id: Optional[str] = None):
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": pid,
        **payload.dict(),
        "stars": 0,
        "star_count": 0,
        "downloads": 0,
        "starred_by": [],
        "created_at": now,
    }
    await db.eq_profiles.insert_one(doc)
    doc.pop("_id", None)
    return _profile_to_out(doc, user_id)


class StarBody(BaseModel):
    user_id: str


@api_router.post("/eq-profiles/{profile_id}/star")
async def toggle_star(profile_id: str, body: StarBody):
    doc = await db.eq_profiles.find_one({"id": profile_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    starred_by = doc.get("starred_by") or []
    if body.user_id in starred_by:
        starred_by = [u for u in starred_by if u != body.user_id]
    else:
        starred_by = starred_by + [body.user_id]
    await db.eq_profiles.update_one(
        {"id": profile_id},
        {"$set": {"starred_by": starred_by, "star_count": len(starred_by)}},
    )
    return {"stars": len(starred_by), "starred": body.user_id in starred_by}


@api_router.post("/eq-profiles/{profile_id}/download")
async def bump_download(profile_id: str):
    res = await db.eq_profiles.update_one({"id": profile_id}, {"$inc": {"downloads": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"ok": True}


@api_router.get("/eq-profiles/{profile_id}/config", response_class=PlainTextResponse)
async def get_profile_config(profile_id: str):
    doc = await db.eq_profiles.find_one({"id": profile_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    # Serialize as Equalizer APO format
    lines = [f"# ChromeAmp profile: {doc['name']} by {doc['author']}",
             f"Preamp: {float(doc.get('preamp', 0)):.1f} dB"]
    for i, b in enumerate(doc.get("bands", []), start=1):
        lines.append(
            f"Filter {i}: {'ON' if b.get('enabled', True) else 'OFF'} {b['type']} "
            f"Fc {float(b['freq']):.0f} Hz Gain {float(b.get('gain', 0)):.1f} dB Q {float(b.get('q', 1.0)):.3f}"
        )
    # Bump download count
    await db.eq_profiles.update_one({"id": profile_id}, {"$inc": {"downloads": 1}})
    return "\n".join(lines)


# --- Lyrics ---
class LyricsOut(BaseModel):
    source: str
    title: str
    artist: str = ""
    album: str = ""
    plainLyrics: str = ""
    syncedLyrics: str = ""
    providerTrackId: str = ""


class AlbumArtOut(BaseModel):
    source: str
    title: str = ""
    artist: str = ""
    album: str = ""
    artworkUrl: str
    score: float = 0.0


LYRICS_CACHE_TTL_SEC = int(os.environ.get("LYRICS_CACHE_TTL_SEC", str(60 * 60 * 24 * 30)))
MUSIXMATCH_ENABLED = os.environ.get("SHUFFLE_ENABLE_MUSIXMATCH", "true").lower() not in {"0", "false", "no"}
MUSIXMATCH_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _lyrics_cache_key(track: str, artist: Optional[str]) -> str:
    return f"{(artist or '').strip().lower()}::{track.strip().lower()}"


def _norm_text(value: Optional[str]) -> str:
    value = value or ""
    value = re.sub(r"\[[^\]]*]|\([^)]*\)", " ", value)
    value = re.sub(r"\b(official|audio|video|lyrics?|lyric video|remaster(?:ed)?|radio edit|explicit|clean)\b", " ", value, flags=re.I)
    value = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return re.sub(r"\s+", " ", value).strip()


def _similar(a: Optional[str], b: Optional[str]) -> float:
    na = _norm_text(a)
    nb = _norm_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.88
    return SequenceMatcher(None, na, nb).ratio()


def _duration_score(candidate_sec: Optional[float], target_sec: Optional[float]) -> float:
    if not candidate_sec or not target_sec:
        return 0.0
    diff = abs(float(candidate_sec) - float(target_sec))
    if diff <= 2:
        return 1.0
    if diff <= 6:
        return 0.75
    if diff <= 12:
        return 0.35
    return -0.25


def _score_track(candidate_title: Optional[str], candidate_artist: Optional[str], track: str, artist: Optional[str], candidate_duration: Optional[float] = None, duration: Optional[float] = None, candidate_album: Optional[str] = None, album: Optional[str] = None) -> float:
    score = _similar(candidate_title, track) * 0.52
    if artist:
        score += _similar(candidate_artist, artist) * 0.30
    else:
        score += 0.08
    if album:
        score += _similar(candidate_album, album) * 0.12
    else:
        score += 0.04
    score += _duration_score(candidate_duration, duration) * 0.08
    return score


def _lyrics_from_lrclib(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[LyricsOut]:
    params = {"track_name": track}
    if artist:
        params["artist_name"] = artist
    if album:
        params["album_name"] = album
    if duration:
        params["duration"] = str(round(duration))
    res = requests.get("https://lrclib.net/api/search", params=params, timeout=8)
    res.raise_for_status()
    matches = res.json()
    if not isinstance(matches, list):
        return None
    ranked = sorted(
        matches,
        key=lambda match: _score_track(
            match.get("trackName"),
            match.get("artistName"),
            track,
            artist,
            match.get("duration"),
            duration,
            match.get("albumName"),
            album,
        ),
        reverse=True,
    )
    for match in ranked:
        plain = match.get("plainLyrics") or ""
        synced = match.get("syncedLyrics") or ""
        score = _score_track(
            match.get("trackName"),
            match.get("artistName"),
            track,
            artist,
            match.get("duration"),
            duration,
            match.get("albumName"),
            album,
        )
        min_score = 0.78 if artist and album else 0.74 if artist else 0.58
        if (plain or synced) and score >= min_score:
            return LyricsOut(
                source=f"LRCLIB {score:.0%}",
                title=match.get("trackName") or track,
                artist=match.get("artistName") or artist or "",
                album=match.get("albumName") or album or "",
                plainLyrics=plain,
                syncedLyrics=synced,
                providerTrackId=str(match.get("id") or ""),
            )
    return None


@lru_cache(maxsize=1)
def _musixmatch_secret() -> str:
    search = requests.get(
        "https://www.musixmatch.com/search",
        headers={"User-Agent": MUSIXMATCH_USER_AGENT, "Cookie": "mxm_bab=AB"},
        timeout=8,
    )
    search.raise_for_status()
    matches = re.findall(r'src="([^"]*/_next/static/chunks/pages/_app-[^"]+\.js)"', search.text)
    if not matches:
        raise RuntimeError("Musixmatch app bundle not found")
    bundle_url = urllib.parse.urljoin("https://www.musixmatch.com", matches[-1])
    bundle = requests.get(bundle_url, headers={"User-Agent": MUSIXMATCH_USER_AGENT}, timeout=8)
    bundle.raise_for_status()
    match = re.search(r'from\(\s*"(.*?)"\s*\.split', bundle.text)
    if not match:
        raise RuntimeError("Musixmatch signature secret not found")
    return base64.b64decode(match.group(1)[::-1]).decode("utf-8")


def _musixmatch_signed_request(path: str) -> dict:
    base = "https://www.musixmatch.com/ws/1.1/"
    unsigned = base + path.replace("%20", "+").replace(" ", "+")
    now = datetime.now()
    message = f"{unsigned}{now.year}{now.month:02d}{now.day:02d}".encode()
    digest = hmac.new(_musixmatch_secret().encode(), message, hashlib.sha256).digest()
    signature = urllib.parse.quote(base64.b64encode(digest).decode())
    url = f"{unsigned}&signature={signature}&signature_protocol=sha256"
    res = requests.get(url, headers={"User-Agent": MUSIXMATCH_USER_AGENT}, timeout=8)
    res.raise_for_status()
    return res.json()


def _lyrics_from_musixmatch(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[LyricsOut]:
    query = f"{track} {artist or ''}".strip()
    search_path = (
        "track.search?app_id=web-desktop-app-v1.0&format=json"
        f"&q={urllib.parse.quote(query)}&f_has_lyrics=true&page_size=5&page=1"
    )
    search = _musixmatch_signed_request(search_path)
    items = search.get("message", {}).get("body", {}).get("track_list", [])
    if not items:
        return None
    ranked = sorted(
        [item.get("track") or {} for item in items],
        key=lambda info: _score_track(
            info.get("track_name"),
            info.get("artist_name"),
            track,
            artist,
            (float(info.get("track_length")) if info.get("track_length") else None),
            duration,
            info.get("album_name"),
            album,
        ),
        reverse=True,
    )
    track_info = ranked[0] if ranked else {}
    score = _score_track(
        track_info.get("track_name"),
        track_info.get("artist_name"),
        track,
        artist,
        (float(track_info.get("track_length")) if track_info.get("track_length") else None),
        duration,
        track_info.get("album_name"),
        album,
    )
    if score < (0.76 if artist and album else 0.72 if artist else 0.56):
        return None
    track_id = track_info.get("track_id")
    if not track_id:
        return None
    lyrics = _musixmatch_signed_request(
        "track.lyrics.get?app_id=web-desktop-app-v1.0&format=json"
        f"&track_id={urllib.parse.quote(str(track_id))}"
    )
    body = lyrics.get("message", {}).get("body", {}).get("lyrics", {})
    text = body.get("lyrics_body") or ""
    if not text:
        return None
    return LyricsOut(
        source=f"Musixmatch {score:.0%}",
        title=track_info.get("track_name") or track,
        artist=track_info.get("artist_name") or artist or "",
        album=track_info.get("album_name") or "",
        plainLyrics=text.strip(),
        providerTrackId=str(track_id),
    )


def _lookup_lyrics_sync(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[LyricsOut]:
    try:
        found = _lyrics_from_lrclib(track, artist, album, duration)
        if found:
            return found
    except Exception as exc:
        logger.warning("LRCLIB lyrics lookup failed: %s", exc)
    if MUSIXMATCH_ENABLED:
        try:
            return _lyrics_from_musixmatch(track, artist, album, duration)
        except Exception as exc:
            logger.warning("Musixmatch lyrics lookup failed: %s", exc)
    return None


@api_router.get("/lyrics", response_model=LyricsOut)
async def get_lyrics(track: str = Query(..., min_length=1), artist: Optional[str] = None, album: Optional[str] = None, duration: Optional[float] = None):
    key = f"{_lyrics_cache_key(track, artist)}::{_norm_text(album)}::{round(duration or 0)}"
    now = int(time.time())
    cached = await db.lyrics_cache.find_one({"key": key}, {"_id": 0})
    if cached and now - int(cached.get("cached_at", 0)) < LYRICS_CACHE_TTL_SEC:
        return LyricsOut(**cached["lyrics"])
    found = await asyncio.to_thread(_lookup_lyrics_sync, track, artist, album, duration)
    if not found:
        raise HTTPException(status_code=404, detail="Lyrics not found")
    await db.lyrics_cache.update_one(
        {"key": key},
        {"$set": {"key": key, "cached_at": now, "lyrics": found.dict()}},
        upsert=True,
    )
    return found


def _coverart_url_for_release_group(mbid: str) -> Optional[str]:
    url = f"https://coverartarchive.org/release-group/{mbid}/front-500"
    res = requests.get(url, allow_redirects=True, timeout=8)
    if res.status_code == 200:
        return res.url
    return None


def _album_art_from_musicbrainz(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[AlbumArtOut]:
    terms = [f'recording:"{track}"']
    if artist:
        terms.append(f'artist:"{artist}"')
    if album:
        terms.append(f'release:"{album}"')
    query = " AND ".join(terms)
    res = requests.get(
        "https://musicbrainz.org/ws/2/recording/",
        params={"query": query, "fmt": "json", "limit": 5},
        headers={"User-Agent": "ShuffleMuSic/1.0.0 (local Android music player)"},
        timeout=8,
    )
    res.raise_for_status()
    recordings = res.json().get("recordings", [])
    candidates: list[tuple[float, dict, dict]] = []
    for rec in recordings:
        for release in rec.get("releases") or []:
            rg = release.get("release-group") or {}
            candidates.append((
                _score_track(
                    rec.get("title"),
                    (rec.get("artist-credit") or [{}])[0].get("name"),
                    track,
                    artist,
                    (float(rec.get("length", 0)) / 1000 if rec.get("length") else None),
                    duration,
                    release.get("title"),
                    album,
                ),
                rec,
                rg,
            ))
    for score, rec, rg in sorted(candidates, key=lambda item: item[0], reverse=True):
        if score < (0.70 if artist else 0.55):
            continue
        if rg.get("id"):
            cover = _coverart_url_for_release_group(rg["id"])
            if cover:
                return AlbumArtOut(
                    source=f"MusicBrainz/Cover Art Archive {score:.0%}",
                    title=rec.get("title") or track,
                    artist=(rec.get("artist-credit") or [{}])[0].get("name") or artist or "",
                    album=rg.get("title") or album or "",
                    artworkUrl=cover,
                    score=score,
                )
    return None


def _album_art_from_itunes(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[AlbumArtOut]:
    term = " ".join([v for v in [artist, track, album] if v])
    res = requests.get(
        "https://itunes.apple.com/search",
        params={"media": "music", "entity": "song", "limit": 15, "term": term, "country": "US"},
        timeout=8,
    )
    res.raise_for_status()
    results = res.json().get("results", [])
    best: Optional[tuple[float, dict]] = None
    for item in results:
        score = _score_track(
            item.get("trackName"),
            item.get("artistName"),
            track,
            artist,
            (float(item.get("trackTimeMillis")) / 1000 if item.get("trackTimeMillis") else None),
            duration,
            item.get("collectionName"),
            album,
        )
        if best is None or score > best[0]:
            best = (score, item)
    if not best or best[0] < (0.70 if artist else 0.55):
        return None
    score, item = best
    raw = item.get("artworkUrl100")
    if not raw:
        return None
    return AlbumArtOut(
        source=f"iTunes {score:.0%}",
        title=item.get("trackName") or track,
        artist=item.get("artistName") or artist or "",
        album=item.get("collectionName") or album or "",
        artworkUrl=re.sub(r"100x100bb\.(jpg|png)$", r"1200x1200bb.\1", raw),
        score=score,
    )


def _lookup_album_art_sync(track: str, artist: Optional[str], album: Optional[str], duration: Optional[float]) -> Optional[AlbumArtOut]:
    try:
        found = _album_art_from_musicbrainz(track, artist, album, duration)
        if found:
            return found
    except Exception as exc:
        logger.warning("MusicBrainz album art lookup failed: %s", exc)
    try:
        return _album_art_from_itunes(track, artist, album, duration)
    except Exception as exc:
        logger.warning("iTunes album art lookup failed: %s", exc)
    return None


@api_router.get("/album-art", response_model=AlbumArtOut)
async def get_album_art(track: str = Query(..., min_length=1), artist: Optional[str] = None, album: Optional[str] = None, duration: Optional[float] = None):
    found = await asyncio.to_thread(_lookup_album_art_sync, track, artist, album, duration)
    if not found:
        raise HTTPException(status_code=404, detail="Album art not found")
    return found


# --- Seed initial community presets on startup ---
SEED_PROFILES: List[dict] = [
    {
        "name": "Studio Reference",
        "author": "ChromeAmp",
        "description": "Neutral curve with a touch of mid clarity. Great for mixing and critical listening.",
        "tags": ["reference", "neutral", "mixing"],
        "preamp": -1.0,
        "bands": [
            {"enabled": True, "type": "PK", "freq": 200, "gain": -1.5, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 2500, "gain": 1.5, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 9000, "gain": 1.0, "q": 0.71},
        ],
    },
    {
        "name": "Mega Bass",
        "author": "BassHead",
        "description": "Heavy sub-bass shelf with a punch around 80Hz. Best for hip-hop and EDM.",
        "tags": ["bass", "edm", "hiphop"],
        "preamp": -5.0,
        "bands": [
            {"enabled": True, "type": "LSC", "freq": 60, "gain": 8.0, "q": 0.71},
            {"enabled": True, "type": "PK", "freq": 100, "gain": 4.0, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 400, "gain": -2.0, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 10000, "gain": 2.0, "q": 0.71},
        ],
    },
    {
        "name": "Crystal Vocals",
        "author": "MixEngineer",
        "description": "Pulls vocals forward with a presence boost and a gentle mud cut.",
        "tags": ["vocals", "pop", "acoustic"],
        "preamp": -2.0,
        "bands": [
            {"enabled": True, "type": "PK", "freq": 250, "gain": -3.0, "q": 1.2},
            {"enabled": True, "type": "PK", "freq": 2800, "gain": 4.5, "q": 0.9},
            {"enabled": True, "type": "PK", "freq": 5500, "gain": 2.0, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 9000, "gain": 2.0, "q": 0.71},
        ],
    },
    {
        "name": "Vinyl Warmth",
        "author": "Audiophile",
        "description": "Lush low-mids and a gentle high-end roll-off — analog vinyl feel.",
        "tags": ["warm", "vinyl", "analog", "jazz"],
        "preamp": -2.0,
        "bands": [
            {"enabled": True, "type": "LSC", "freq": 120, "gain": 3.0, "q": 0.71},
            {"enabled": True, "type": "PK", "freq": 350, "gain": 1.5, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 12000, "gain": -3.0, "q": 0.71},
        ],
    },
    {
        "name": "Live Concert",
        "author": "StageEng",
        "description": "Wide stereo image illusion with bass impact, mid scoop and air on top.",
        "tags": ["live", "concert", "rock"],
        "preamp": -3.0,
        "bands": [
            {"enabled": True, "type": "LSC", "freq": 70, "gain": 4.0, "q": 0.71},
            {"enabled": True, "type": "PK", "freq": 500, "gain": -2.5, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 3500, "gain": 3.0, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 11000, "gain": 3.5, "q": 0.71},
        ],
    },
    {
        "name": "Hip-Hop Punch",
        "author": "BeatHead",
        "description": "Sub thump + crisp hi-hats. Tight low end without flab.",
        "tags": ["hiphop", "rap", "trap"],
        "preamp": -4.0,
        "bands": [
            {"enabled": True, "type": "PK", "freq": 50, "gain": 5.0, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 80, "gain": 3.0, "q": 1.4},
            {"enabled": True, "type": "PK", "freq": 8000, "gain": 3.0, "q": 1.0},
            {"enabled": True, "type": "HSC", "freq": 12000, "gain": 2.5, "q": 0.71},
        ],
    },
    {
        "name": "Classical Concerto",
        "author": "Maestro",
        "description": "Reveals string detail and orchestral air without harshness.",
        "tags": ["classical", "orchestra"],
        "preamp": -1.0,
        "bands": [
            {"enabled": True, "type": "LSC", "freq": 50, "gain": -2.0, "q": 0.71},
            {"enabled": True, "type": "PK", "freq": 200, "gain": 1.5, "q": 0.9},
            {"enabled": True, "type": "PK", "freq": 4000, "gain": 1.5, "q": 1.2},
            {"enabled": True, "type": "HSC", "freq": 10000, "gain": 2.5, "q": 0.71},
        ],
    },
    {
        "name": "K-Pop Brightness",
        "author": "Idol",
        "description": "Bright vocal-forward tuning with a punchy bassline.",
        "tags": ["kpop", "pop", "vocals"],
        "preamp": -3.0,
        "bands": [
            {"enabled": True, "type": "LSC", "freq": 80, "gain": 3.0, "q": 0.71},
            {"enabled": True, "type": "PK", "freq": 300, "gain": -1.5, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 3000, "gain": 3.5, "q": 1.0},
            {"enabled": True, "type": "PK", "freq": 6000, "gain": 2.5, "q": 1.2},
            {"enabled": True, "type": "HSC", "freq": 10000, "gain": 3.0, "q": 0.71},
        ],
    },
]


@app.on_event("startup")
async def seed_profiles():
    count = await db.eq_profiles.count_documents({})
    if count == 0:
        for p in SEED_PROFILES:
            doc = {
                "id": str(uuid.uuid4()),
                **p,
                "stars": 0,
                "star_count": 0,
                "downloads": 0,
                "starred_by": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.eq_profiles.insert_one(doc)
        logger.info(f"Seeded {len(SEED_PROFILES)} EQ profiles")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
