"""Regression coverage for a real bug found while browser-testing the app:
GET /donation-counts/?sport_id=... (the exact URL the frontend calls, with a
trailing slash) returned 405 Method Not Allowed, because PUT was registered
at the literal path "/donation-counts/" while GET was registered at
"/donation-counts" (no slash) — an exact route match on the wrong method
short-circuits Starlette's automatic slash-redirect, which only kicks in when
no route matches the literal requested path at all.

This class of bug is invisible to tests that call router functions directly
(they skip HTTP routing entirely) and to `call the correct URL` tests (they
only exercise the path someone thought to type). It only shows up by
querying real routes through the ASGI layer with both slash variants.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.routers import (
    companies, sports, brackets, teams, matches, event_points,
    leaderboard, roster_entries, locations, alerts, donation_counts,
)
from fake_db import FakeSupabase

_ROUTER_MODULES = [
    companies, sports, brackets, teams, matches, event_points,
    leaderboard, roster_entries, locations, alerts, donation_counts,
]


def _get_paths_no_params():
    """Every registered GET route with no path parameters — the class of
    route (list/collection endpoints) affected by this bug."""
    paths = []
    for route in app.routes:
        if not hasattr(route, "methods") or "GET" not in (route.methods or set()):
            continue
        if "{" in route.path:
            continue
        if route.path in ("/health", "/me"):
            continue
        paths.append(route.path)
    return paths


def test_no_collection_route_registered_with_trailing_slash_only_for_other_methods():
    """Static structural check: no router may register a mutating method
    (POST/PUT/DELETE) at a bare "/" path while its sibling GET list route
    omits the slash — that combination creates the exact 405 trap this test
    file exists to prevent. (The live-request test below proves the
    resulting behavior; this proves the anti-pattern doesn't return.)"""
    offenders = []
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        if route.path.endswith("/") and methods - {"HEAD", "OPTIONS"}:
            offenders.append((route.path, methods))
    assert not offenders, f"routes registered at a bare trailing-slash path: {offenders}"


def test_get_routes_work_with_trailing_slash(monkeypatch):
    """The frontend's apiFetch convention appends a trailing slash before the
    query string (e.g. `/donation-counts/?sport_id=...`) — every parameterless
    GET route must serve that form without a 405, mirroring what a browser
    actually sends. Routers' `supabase` is patched to an in-memory fake so
    this runs at unit-test speed instead of hitting a real (absent) network
    dependency on every one of ~15 routes."""
    db = FakeSupabase()
    for mod in _ROUTER_MODULES:
        monkeypatch.setattr(mod, "supabase", db)

    client = TestClient(app, raise_server_exceptions=False)
    paths = _get_paths_no_params()
    assert paths, "no GET routes found — route discovery is broken"

    for path in paths:
        resp = client.get(f"{path}/")
        assert resp.status_code != 405, (
            f"GET {path}/ returned 405 — a sibling route is likely registered "
            f"at the literal '{path}/' path for a different method"
        )
