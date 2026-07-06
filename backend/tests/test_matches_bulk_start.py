"""POST /matches/bulk-start: start every listed match in one request — used
by Water Ball Toss's "Start Group" button so a whole group's teams start
their round together instead of one Start tap per team."""

import app.routers.matches as matches_router
from fake_db import FakeSupabase


def _make_match(db, status="scheduled"):
    return db.table("matches").insert({
        "sport_id": "sport-1",
        "home_team_id": "team-1",
        "away_team_id": None,
        "status": status,
    }).execute().data[0]["id"]


def test_bulk_start_marks_all_listed_matches_in_progress(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    a = _make_match(db)
    b = _make_match(db)

    result = matches_router.bulk_start_matches(matches_router.BulkStartRequest(match_ids=[a, b]))

    assert {r["id"] for r in result} == {a, b}
    assert all(r["status"] == "in_progress" for r in result)
    assert all(r["actual_start"] is not None for r in result)


def test_bulk_start_skips_matches_not_scheduled(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    scheduled = _make_match(db, status="scheduled")
    already_started = _make_match(db, status="in_progress")

    result = matches_router.bulk_start_matches(
        matches_router.BulkStartRequest(match_ids=[scheduled, already_started])
    )

    assert [r["id"] for r in result] == [scheduled]


def test_bulk_start_with_empty_list_returns_empty(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    assert matches_router.bulk_start_matches(matches_router.BulkStartRequest(match_ids=[])) == []
