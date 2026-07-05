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
