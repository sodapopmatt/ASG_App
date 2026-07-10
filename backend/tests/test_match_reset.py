"""POST /matches/{id}/reset: undo a submitted result/forfeit/double-forfeit/draw
back to the match's pre-result state, reusing the same retraction machinery
that already backs result corrections."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.bracket_engine.generator import persist_bracket

from fake_db import FakeSupabase
from router_harness import RouterHarness, PoolSpec
from invariants import assert_team_states_consistent

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 30


def make_db(bracket_type, n_teams):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Reset Test Sport",
        "bracket_type": bracket_type,
        "match_duration_minutes": DUR,
    }).execute().data[0]
    team_ids = []
    for i in range(n_teams):
        team = db.table("teams").insert({
            "company_id": f"company-{i}",
            "sport_id": sport["id"],
            "name": f"T{i}",
        }).execute().data[0]
        team_ids.append(team["id"])
    return db, sport["id"], team_ids


def get_match(db, match_id):
    return db.table("matches").select("*").eq("id", match_id).execute().data[0]


def test_reset_result_returns_to_scheduled_and_clears_downstream(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    r1 = [m for m in rows if m["match_round"] == 1]
    final = next(m for m in rows if m["match_round"] == 2)
    m = r1[0]
    home, away = m["home_team_id"], m["away_team_id"]

    h.result(m["id"], home)
    slots = get_match(db, final["id"])
    assert home in (slots["home_team_id"], slots["away_team_id"])

    h.reset(m["id"])
    reset_match = get_match(db, m["id"])
    assert reset_match["status"] == "scheduled"
    assert reset_match["winner_id"] is None
    assert reset_match["home_score"] is None
    assert reset_match["away_score"] is None
    assert reset_match["played_at"] is None

    slots = get_match(db, final["id"])
    assert home not in (slots["home_team_id"], slots["away_team_id"])
    assert_team_states_consistent(db.rows("matches"))

    # Fully playable again afterwards.
    h.result(m["id"], away)
    slots = get_match(db, final["id"])
    assert away in (slots["home_team_id"], slots["away_team_id"])


def test_reset_preserves_in_progress_if_match_had_started(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    m = [r for r in rows if r["match_round"] == 1][0]

    from app.routers.matches import start_match
    start_match(m["id"])
    h.result(m["id"], m["home_team_id"])
    h.reset(m["id"])

    reset_match = get_match(db, m["id"])
    assert reset_match["status"] == "in_progress"
    assert reset_match["actual_start"] is not None


def test_reset_blocked_after_downstream_played(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    r1 = [m for m in rows if m["match_round"] == 1]
    final = next(m for m in rows if m["match_round"] == 2)

    h.result(r1[0]["id"], r1[0]["home_team_id"])
    h.result(r1[1]["id"], r1[1]["home_team_id"])
    h.result(final["id"], r1[0]["home_team_id"])  # final has been played

    with pytest.raises(HTTPException) as exc:
        h.reset(r1[0]["id"])
    assert exc.value.status_code == 409
    assert_team_states_consistent(db.rows("matches"))


def test_reset_after_forfeit(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    final = next(m for m in rows if m["match_round"] == 2)
    m = [r for r in rows if r["match_round"] == 1][0]

    h.forfeit(m["id"], m["away_team_id"])
    h.reset(m["id"])

    reset_match = get_match(db, m["id"])
    assert reset_match["status"] == "scheduled"
    assert reset_match["winner_id"] is None
    slots = get_match(db, final["id"])
    assert m["home_team_id"] not in (slots["home_team_id"], slots["away_team_id"])
    assert_team_states_consistent(db.rows("matches"))


def test_reset_after_draw(monkeypatch):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Soccer", "bracket_type": "pool_bracket", "match_duration_minutes": DUR,
    }).execute().data[0]
    team_ids = []
    for i in range(2):
        team = db.table("teams").insert({
            "company_id": f"company-{i}", "sport_id": sport["id"], "name": f"T{i}",
        }).execute().data[0]
        team_ids.append(team["id"])
    court = db.table("locations").insert({"sport_id": sport["id"], "name": "Field 1"}).execute().data[0]

    h = RouterHarness(db, monkeypatch)
    h.generate(sport["id"], pools=[PoolSpec(name="Pool A", team_ids=team_ids, location_ids=[court["id"]])])

    m = db.rows("matches")[0]
    h.draw(m["id"], home_score=1, away_score=1)
    reset_match = get_match(db, m["id"])
    assert reset_match["status"] == "draw"

    h.reset(m["id"])
    reset_match = get_match(db, m["id"])
    assert reset_match["status"] == "scheduled"
    assert reset_match["winner_id"] is None
    assert reset_match["home_score"] is None
    assert reset_match["away_score"] is None


def test_reset_double_forfeit_simple(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    r1 = [m for m in rows if m["match_round"] == 1]
    final = next(m for m in rows if m["match_round"] == 2)
    m1 = r1[0]

    h.double_forfeit(m1["id"])
    slots = get_match(db, final["id"])
    assert slots["home_slot_state"] == "bye" or slots["away_slot_state"] == "bye"
    assert slots["status"] == "scheduled"  # other semifinal hasn't been played yet

    h.reset(m1["id"])
    reset_match = get_match(db, m1["id"])
    assert reset_match["status"] == "scheduled"
    assert reset_match["winner_id"] is None

    slots = get_match(db, final["id"])
    assert slots["home_slot_state"] != "bye"
    assert slots["away_slot_state"] != "bye"
    assert_team_states_consistent(db.rows("matches"))

    # Fully playable again afterwards.
    h.result(m1["id"], m1["home_team_id"])
    slots = get_match(db, final["id"])
    assert m1["home_team_id"] in (slots["home_team_id"], slots["away_team_id"])


def test_reset_double_forfeit_blocked_after_downstream_progressed(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    rows = db.rows("matches")
    r1 = [m for m in rows if m["match_round"] == 1]
    final = next(m for m in rows if m["match_round"] == 2)
    m1, m2 = r1[0], r1[1]

    h.double_forfeit(m1["id"])
    h.result(m2["id"], m2["home_team_id"])  # fills final's other slot -> auto-completes via bye

    slots = get_match(db, final["id"])
    assert slots["status"] == "completed"

    with pytest.raises(HTTPException) as exc:
        h.reset(m1["id"])
    assert exc.value.status_code == 409
    assert_team_states_consistent(db.rows("matches"))


def test_reset_requires_existing_result(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                     match_duration_minutes=DUR)

    m = [r for r in db.rows("matches") if r["match_round"] == 1][0]
    with pytest.raises(HTTPException) as exc:
        h.reset(m["id"])
    assert exc.value.status_code == 422


def test_reset_not_found(monkeypatch):
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        h.reset("does-not-exist")
    assert exc.value.status_code == 404
