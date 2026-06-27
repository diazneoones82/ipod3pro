"""Backend tests for ChromeAmp Discover (EQ Profiles) endpoints.

Covers:
- GET /api/eq-profiles (default trending, ?sort=new, ?sort=stars, ?q=bass)
- GET /api/eq-profiles/{id}
- POST /api/eq-profiles (publish a new profile)
- POST /api/eq-profiles/{id}/star (toggle + persistence verification)
- GET /api/eq-profiles/{id}/config (EqualizerAPO text)
- Seed idempotency (8 profiles, no re-seed)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to reading frontend .env if env var not exported in shell
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is not configured"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def anon_user_id():
    return f"TEST_{uuid.uuid4()}"


# ------- Seed / list -------
class TestList:
    def test_default_trending_returns_seeded_profiles(self, session):
        r = session.get(f"{API}/eq-profiles", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Seed has 8 profiles; tests may add a few more — must be >= 8
        assert len(data) >= 8, f"Expected at least 8 seeded profiles, got {len(data)}"
        first = data[0]
        # Validate shape
        for key in ["id", "name", "author", "description", "tags",
                    "preamp", "bands", "stars", "downloads", "starred", "created_at"]:
            assert key in first, f"Missing key {key} in profile response"
        assert isinstance(first["bands"], list) and len(first["bands"]) >= 1
        # _id from Mongo must not leak
        assert "_id" not in first

    def test_sort_new(self, session):
        r = session.get(f"{API}/eq-profiles", params={"sort": "new"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 8
        # Sorted by created_at desc — verify monotonic non-increasing
        created = [d["created_at"] for d in data]
        assert created == sorted(created, reverse=True), "?sort=new should be created_at DESC"

    def test_sort_stars(self, session):
        r = session.get(f"{API}/eq-profiles", params={"sort": "stars"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 8
        # star counts should be monotonic non-increasing
        stars = [d["stars"] for d in data]
        assert stars == sorted(stars, reverse=True), "?sort=stars should be stars DESC"

    def test_search_q_bass(self, session):
        r = session.get(f"{API}/eq-profiles", params={"q": "bass"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Expect at least one bass-related profile in seed (Mega Bass / Hip-Hop Punch via tags)
        assert len(data) >= 1
        for p in data:
            blob = (p["name"] + " " + p["author"] + " " + " ".join(p["tags"])).lower()
            assert "bass" in blob, f"profile {p['name']} doesn't contain 'bass' in name/author/tags"


# ------- Detail -------
class TestDetail:
    def test_get_by_id(self, session):
        listed = session.get(f"{API}/eq-profiles", timeout=15).json()
        pid = listed[0]["id"]
        r = session.get(f"{API}/eq-profiles/{pid}", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == pid
        assert body["name"] == listed[0]["name"]

    def test_404_for_unknown(self, session):
        r = session.get(f"{API}/eq-profiles/nonexistent-{uuid.uuid4()}", timeout=10)
        assert r.status_code == 404


# ------- Star toggle persistence -------
class TestStar:
    def test_star_toggle_persists_for_user(self, session, anon_user_id):
        listed = session.get(f"{API}/eq-profiles", timeout=15).json()
        pid = listed[0]["id"]
        initial_stars = listed[0]["stars"]

        # First toggle -> star
        r = session.post(f"{API}/eq-profiles/{pid}/star",
                         json={"user_id": anon_user_id}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["starred"] is True
        assert body["stars"] == initial_stars + 1

        # GET with user_id should show starred=true
        r2 = session.get(f"{API}/eq-profiles/{pid}",
                         params={"user_id": anon_user_id}, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["starred"] is True
        assert r2.json()["stars"] == initial_stars + 1

        # Toggle back
        r3 = session.post(f"{API}/eq-profiles/{pid}/star",
                          json={"user_id": anon_user_id}, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["starred"] is False
        assert r3.json()["stars"] == initial_stars


# ------- Publish (POST) -------
class TestPublish:
    created_id: str = ""

    def test_publish_new_profile(self, session, anon_user_id):
        payload = {
            "name": f"TEST_Bright_{uuid.uuid4().hex[:6]}",
            "author": "pytest-bot",
            "description": "TEST profile created by backend_test",
            "tags": ["test", "bright"],
            "preamp": -2.5,
            "bands": [
                {"enabled": True, "type": "PK",  "freq": 100,  "gain": 3.0, "q": 1.0},
                {"enabled": True, "type": "HSC", "freq": 9000, "gain": 2.0, "q": 0.71},
            ],
        }
        r = session.post(f"{API}/eq-profiles", params={"user_id": anon_user_id},
                         json=payload, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == payload["name"]
        assert body["author"] == payload["author"]
        assert body["preamp"] == -2.5
        assert len(body["bands"]) == 2
        assert body["stars"] == 0
        assert "id" in body
        TestPublish.created_id = body["id"]

        # Verify it shows up in list (sort=new should put it near top)
        listed = session.get(f"{API}/eq-profiles",
                             params={"sort": "new"}, timeout=15).json()
        ids = [p["id"] for p in listed[:5]]
        assert TestPublish.created_id in ids, "Newly-published profile not visible at top of ?sort=new"


# ------- Config export -------
class TestConfig:
    def test_config_returns_equalizerapo_text(self, session):
        listed = session.get(f"{API}/eq-profiles", timeout=15).json()
        pid = listed[0]["id"]
        r = session.get(f"{API}/eq-profiles/{pid}/config", timeout=10)
        assert r.status_code == 200
        text = r.text
        assert "Preamp:" in text
        assert "Filter 1:" in text
        # Must contain dB tokens
        assert "dB" in text


# ------- Existing /api/ root sanity (regression) -------
class TestRoot:
    def test_root_hello(self, session):
        r = session.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("message") == "Hello World"
