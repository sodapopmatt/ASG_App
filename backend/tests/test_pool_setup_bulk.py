"""Regression coverage for a live crash: set_pool_setup / set_seed_order used
to update one team/court row at a time in a sequential loop. With Pickleball's
113 teams, that meant ~137 sequential HTTP round-trips inside a single
request — measured at ~13s against real Supabase, and it crashed outright
with a socket-level error mid-loop when reproduced live. Fixed to a single
bulk upsert per table. These tests pin the *safety* of that upsert (it must
preserve every other column) since a naive upsert with only the changed
column nulls out any NOT NULL column not included in the payload — confirmed
empirically against real Supabase before writing this fix."""

import app.routers.sports as sports_router
from app.routers.sports import PoolSetupRequest, SeedOrderRequest

from fake_db import FakeSupabase


def _make_sport_with_teams(db, n_teams):
    sport = db.table("sports").insert({"name": "Pickleball", "pool_count": None}).execute().data[0]
    teams = [
        db.table("teams").insert({
            "company_id": f"co-{i}", "sport_id": sport["id"], "name": f"T{i}", "seed": i, "pool_index": -2,
        }).execute().data[0]
        for i in range(n_teams)
    ]
    return sport, teams


def test_pool_setup_updates_pool_index_without_losing_other_columns(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport, teams = _make_sport_with_teams(db, 50)

    team_pool = {t["id"]: i % 5 for i, t in enumerate(teams)}
    sports_router.set_pool_setup(sport["id"], PoolSetupRequest(pool_count=5, team_pool=team_pool))

    rows = db.table("teams").select("*").eq("sport_id", sport["id"]).execute().data
    row_by_id = {r["id"]: r for r in rows}
    for t in teams:
        row = row_by_id[t["id"]]
        assert row["pool_index"] == team_pool[t["id"]]
        # every other column survives untouched
        assert row["name"] == t["name"]
        assert row["company_id"] == t["company_id"]
        assert row["sport_id"] == t["sport_id"]
        assert row["seed"] == t["seed"]

    sport_row = db.table("sports").select("*").eq("id", sport["id"]).execute().data[0]
    assert sport_row["pool_count"] == 5


def test_pool_setup_updates_court_pool_index(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport = db.table("sports").insert({"name": "Soccer"}).execute().data[0]
    courts = [
        db.table("locations").insert({
            "sport_id": sport["id"], "name": f"Field {i}", "court_number": i, "pool_index": -1,
        }).execute().data[0]
        for i in range(6)
    ]

    court_pool = {c["id"]: i % 3 for i, c in enumerate(courts)}
    sports_router.set_pool_setup(sport["id"], PoolSetupRequest(court_pool=court_pool))

    rows = db.table("locations").select("*").eq("sport_id", sport["id"]).execute().data
    row_by_id = {r["id"]: r for r in rows}
    for c in courts:
        row = row_by_id[c["id"]]
        assert row["pool_index"] == court_pool[c["id"]]
        assert row["name"] == c["name"]
        assert row["court_number"] == c["court_number"]


def test_pool_setup_scoped_to_sport_id(monkeypatch):
    """A team_id belonging to a different sport must never be touched, even
    if it somehow appears in the request — the scoping filter must survive
    the switch from per-row .eq() checks to a batch fetch."""
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport_a, teams_a = _make_sport_with_teams(db, 3)
    sport_b, teams_b = _make_sport_with_teams(db, 2)

    # Maliciously/mistakenly include a team from sport_b in sport_a's request
    team_pool = {t["id"]: 0 for t in teams_a}
    team_pool[teams_b[0]["id"]] = 0

    sports_router.set_pool_setup(sport_a["id"], PoolSetupRequest(team_pool=team_pool))

    untouched = db.table("teams").select("*").eq("id", teams_b[0]["id"]).execute().data[0]
    assert untouched["pool_index"] == -2  # unchanged from its initial value


def test_pool_setup_handles_large_team_count(monkeypatch):
    """The exact class of input that crashed live: a sport with 100+ teams."""
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport, teams = _make_sport_with_teams(db, 113)

    team_pool = {t["id"]: i % 12 for i, t in enumerate(teams)}
    sports_router.set_pool_setup(sport["id"], PoolSetupRequest(pool_count=12, team_pool=team_pool))

    rows = db.table("teams").select("*").eq("sport_id", sport["id"]).execute().data
    assert len(rows) == 113
    assert all(r["pool_index"] == team_pool[r["id"]] for r in rows)
    assert all(r["name"] is not None and r["company_id"] is not None for r in rows)


def test_seed_order_updates_without_losing_other_columns(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport, teams = _make_sport_with_teams(db, 8)

    reordered = list(reversed([t["id"] for t in teams]))
    sports_router.set_seed_order(sport["id"], SeedOrderRequest(team_ids=reordered))

    rows = {r["id"]: r for r in db.table("teams").select("*").eq("sport_id", sport["id"]).execute().data}
    for i, team_id in enumerate(reordered):
        assert rows[team_id]["seed"] == i
        original = next(t for t in teams if t["id"] == team_id)
        assert rows[team_id]["name"] == original["name"]
        assert rows[team_id]["company_id"] == original["company_id"]


def test_seed_order_empty_list_is_a_noop(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport, teams = _make_sport_with_teams(db, 3)
    sports_router.set_seed_order(sport["id"], SeedOrderRequest(team_ids=[]))
    rows = db.table("teams").select("*").eq("sport_id", sport["id"]).execute().data
    assert all(r["seed"] == t["seed"] for r, t in zip(rows, teams))
