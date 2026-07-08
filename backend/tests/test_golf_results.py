"""Executive Golf scoring: real per-team matches (bracket_type='heats') in two
"Round 1"/"Round 2" heat brackets. Three hole scores per company are entered
via /golf-results (stored as a JSON array in matches.notes, total in
home_score). Final ranking is Round-2 total strokes only (lowest wins); the
Round-2 companies take placements 1..N (ties sharing points) and everyone else
who competed shares a participation placement."""

import json
import pytest
from fastapi import HTTPException

import app.routers.golf_results as gr
from app.routers.golf_results import GolfResult
from fake_db import FakeSupabase

GOLF_SCALE = {"1": 20, "2": 15, "3": 10, "default": 5}


@pytest.fixture
def db(monkeypatch):
    d = FakeSupabase()
    monkeypatch.setattr(gr, "supabase", d)
    return d


def _make_sport(db, **overrides):
    payload = {"name": "Executive Golf", "bracket_type": "heats", "scoring_mode": "executive_golf", "points_scale": GOLF_SCALE}
    payload.update(overrides)
    return db.table("sports").insert(payload).execute().data[0]["id"]


def _make_bracket(db, sport_id, name):
    return db.table("brackets").insert({"sport_id": sport_id, "name": name, "phase": "heats"}).execute().data[0]["id"]


def _make_team(db, sport_id, company_id):
    return db.table("teams").insert({"sport_id": sport_id, "company_id": company_id}).execute().data[0]["id"]


def _make_match(db, sport_id, team_id, bracket_id, status="scheduled", home_score=None, notes=None):
    return db.table("matches").insert({
        "sport_id": sport_id,
        "bracket_id": bracket_id,
        "home_team_id": team_id,
        "away_team_id": None,
        "status": status,
        "home_score": home_score,
        "notes": notes,
    }).execute().data[0]["id"]


# ── result endpoint ─────────────────────────────────────────────────────────

def test_result_stores_holes_json_and_total(db):
    sport_id = _make_sport(db)
    r1 = _make_bracket(db, sport_id, "Round 1")
    team_id = _make_team(db, sport_id, "company-1")
    match_id = _make_match(db, sport_id, team_id, r1)

    gr.post_golf_result(match_id, GolfResult(hole_scores=[4, 3, 5]))

    m = db.rows("matches")[0]
    assert m["status"] == "completed"
    assert json.loads(m["notes"]) == [4, 3, 5]
    assert m["home_score"] == 12
    assert m["winner_id"] is None


def test_forfeit_clears_scores(db):
    sport_id = _make_sport(db)
    r1 = _make_bracket(db, sport_id, "Round 1")
    team_id = _make_team(db, sport_id, "company-1")
    match_id = _make_match(db, sport_id, team_id, r1, status="completed", home_score=12, notes="[4,3,5]")

    gr.post_golf_result(match_id, GolfResult(forfeit=True))

    m = db.rows("matches")[0]
    assert m["status"] == "forfeit"
    assert m["notes"] is None
    assert m["home_score"] is None


def test_result_rejects_both_and_neither(db):
    sport_id = _make_sport(db)
    r1 = _make_bracket(db, sport_id, "Round 1")
    match_id = _make_match(db, sport_id, _make_team(db, sport_id, "c1"), r1)

    with pytest.raises(HTTPException) as both:
        gr.post_golf_result(match_id, GolfResult(hole_scores=[1, 2, 3], forfeit=True))
    assert both.value.status_code == 422
    with pytest.raises(HTTPException) as neither:
        gr.post_golf_result(match_id, GolfResult())
    assert neither.value.status_code == 422


def test_result_rejects_non_golf_sport(db):
    sport_id = _make_sport(db, scoring_mode="placement")
    r1 = _make_bracket(db, sport_id, "Round 1")
    match_id = _make_match(db, sport_id, _make_team(db, sport_id, "c1"), r1)
    with pytest.raises(HTTPException) as exc:
        gr.post_golf_result(match_id, GolfResult(hole_scores=[1, 2, 3]))
    assert exc.value.status_code == 422


# ── recompute ───────────────────────────────────────────────────────────────

def test_recompute_ranks_round_2_and_awards_participation(db):
    sport_id = _make_sport(db)
    r1 = _make_bracket(db, sport_id, "Round 1")
    r2 = _make_bracket(db, sport_id, "Round 2")
    a, b, c, d = (_make_team(db, sport_id, f"company-{x}") for x in "abcd")
    # Round 1: all four completed (so d "competed")
    for t, total in [(a, 11), (b, 12), (c, 13), (d, 20)]:
        _make_match(db, sport_id, t, r1, status="completed", home_score=total, notes=json.dumps([total]))
    # Round 2: only top 3 advanced; ranked by total ascending
    for t, total in [(a, 10), (b, 12), (c, 15)]:
        _make_match(db, sport_id, t, r2, status="completed", home_score=total, notes=json.dumps([total]))

    gr.recompute_for_sport(sport_id)

    pts = {p["company_id"]: p for p in db.rows("event_points")}
    assert pts["company-a"]["placement"] == 1 and pts["company-a"]["points"] == 20
    assert pts["company-b"]["placement"] == 2 and pts["company-b"]["points"] == 15
    assert pts["company-c"]["placement"] == 3 and pts["company-c"]["points"] == 10
    # d only played Round 1 -> participation placement (after the 3-company group)
    assert pts["company-d"]["placement"] == 4 and pts["company-d"]["points"] == 5


def test_recompute_ties_share_averaged_points(db):
    sport_id = _make_sport(db)
    r2 = _make_bracket(db, sport_id, "Round 2")
    a, b, c = (_make_team(db, sport_id, f"company-{x}") for x in "abc")
    for t, total in [(a, 10), (b, 10), (c, 15)]:  # a,b tie for 1st
        _make_match(db, sport_id, t, r2, status="completed", home_score=total, notes=json.dumps([total]))

    gr.recompute_for_sport(sport_id)

    pts = {p["company_id"]: p for p in db.rows("event_points")}
    # tied 1st/2nd -> average of 20 and 15 = 17.5 -> 18
    assert pts["company-a"]["placement"] == 1 and pts["company-a"]["points"] == 18
    assert pts["company-b"]["placement"] == 1 and pts["company-b"]["points"] == 18
    assert pts["company-c"]["placement"] == 3 and pts["company-c"]["points"] == 10


def test_recompute_round_2_forfeit_ranks_last(db):
    sport_id = _make_sport(db)
    r2 = _make_bracket(db, sport_id, "Round 2")
    a, b = _make_team(db, sport_id, "company-a"), _make_team(db, sport_id, "company-b")
    _make_match(db, sport_id, a, r2, status="completed", home_score=14, notes=json.dumps([14]))
    _make_match(db, sport_id, b, r2, status="forfeit")

    gr.recompute_for_sport(sport_id)

    pts = {p["company_id"]: p for p in db.rows("event_points")}
    assert pts["company-a"]["placement"] == 1 and pts["company-a"]["points"] == 20
    assert pts["company-b"]["placement"] == 2 and pts["company-b"]["points"] == 15


def test_recompute_rejected_for_non_golf_sport(db):
    sport_id = _make_sport(db, scoring_mode="placement")
    with pytest.raises(HTTPException) as exc:
        gr.recompute_for_sport(sport_id)
    assert exc.value.status_code == 422
