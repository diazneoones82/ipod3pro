"""Backend API tests for ChromeAmp music player.
Tests the existing /api/ root + /api/status endpoints.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://shuffle-player-1.preview.emergentagent.com").rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestRoot:
    def test_root_hello_world(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("message") == "Hello World"


class TestStatus:
    def test_get_status_list(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/status", timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_status_and_persistence(self, api_client):
        payload = {"client_name": "TEST_chromeamp"}
        c = api_client.post(f"{BASE_URL}/api/status", json=payload, timeout=20)
        assert c.status_code == 200, c.text
        body = c.json()
        assert body.get("client_name") == "TEST_chromeamp"
        assert "id" in body and "timestamp" in body
        new_id = body["id"]

        g = api_client.get(f"{BASE_URL}/api/status", timeout=20)
        assert g.status_code == 200
        items = g.json()
        assert any(it.get("id") == new_id for it in items), "newly created status not persisted"
