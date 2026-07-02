"""Chaos tournaments: play full brackets through the real endpoints with
forfeits, double forfeits, and result corrections mixed in at random
(seeded — every run is reproducible). Structural consistency is asserted
after every single action."""

import random
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.bracket_engine.generator import persist_bracket
from app.routers.matches import _compute_estimated_starts

from fake_db import FakeSupabase
from router_harness import RouterHarness
from invariants import (
    assert_no_court_overlap,
    assert_feeder_ordering,
    assert_team_states_consistent,
)

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 30
TERMINAL = {"completed", "forfeit", "double_forfeit"}


def make_db(bracket_type, n_teams):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Chaos Sport",
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


def check_all(db, sport_id):
    rows = db.rows("matches")
    assert_team_states_consistent(rows)
    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    assert_no_court_overlap(rows, est, DUR)
    assert_feeder_ordering(rows, est, DUR)
    return rows


@pytest.mark.parametrize("seed", [0, 1, 2])
@pytest.mark.parametrize("bracket_type", ["single_elimination", "double_elimination"])
@pytest.mark.parametrize("n_teams", [4, 5, 8, 11])
def test_chaos_tournament(bracket_type, n_teams, seed, monkeypatch):
    db, sport_id, team_ids = make_db(bracket_type, n_teams)
    h = RouterHarness(db, monkeypatch)
    rng = random.Random(f"{bracket_type}-{n_teams}-{seed}")

    persist_bracket(
        sport_id, team_ids, db,
        location_ids=["court-0", "court-1"], start_time=START,
        match_duration_minutes=DUR,
    )

    corrections_applied = 0
    max_iters = len(db.rows("matches")) * 4 + 20
    finished = False
    for _ in range(max_iters):
        rows = check_all(db, sport_id)

        playable = [
            m for m in rows
            if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
        ]
        if not playable:
            finished = True
            break

        m = rng.choice(playable)
        home, away = m["home_team_id"], m["away_team_id"]
        roll = rng.random()

        if roll < 0.55:
            h.result(m["id"], rng.choice([home, away]))
        elif roll < 0.70:
            h.forfeit(m["id"], rng.choice([home, away]))
        elif roll < 0.80:
            h.double_forfeit(m["id"])
        else:
            # Admin mistake: submit one winner, then immediately correct to the
            # other. The engine must either apply the correction cleanly or
            # refuse it with a 409 — never corrupt the bracket.
            first, second = (home, away) if rng.random() < 0.5 else (away, home)
            h.result(m["id"], first)
            check_all(db, sport_id)
            try:
                h.result(m["id"], second)
                corrections_applied += 1
            except HTTPException as exc:
                assert exc.status_code == 409

        check_all(db, sport_id)

    assert finished, "chaos tournament never resolved (deadlock or runaway)"

    rows = db.rows("matches")
    stuck = [m for m in rows if m["status"] not in TERMINAL]
    assert not stuck, f"{len(stuck)} matches never resolved"

    # Exactly one root; its winner is the champion unless everyone forfeited out
    roots = [m for m in rows if m["winner_next_match_id"] is None]
    assert len(roots) == 1
    root = roots[0]
    assert root["status"] in TERMINAL
    if root["status"] != "double_forfeit":
        assert root["winner_id"] is not None


def test_correction_moves_winner_downstream(monkeypatch):
    """Correcting a result must swap the advanced team in the next round."""
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
    slots = db.table("matches").select("*").eq("id", final["id"]).execute().data[0]
    assert home in (slots["home_team_id"], slots["away_team_id"])

    h.result(m["id"], away)  # correction
    slots = db.table("matches").select("*").eq("id", final["id"]).execute().data[0]
    assert away in (slots["home_team_id"], slots["away_team_id"])
    assert home not in (slots["home_team_id"], slots["away_team_id"])
    assert_team_states_consistent(db.rows("matches"))


def test_correction_blocked_after_downstream_played(monkeypatch):
    """Once the advanced team has played further, the correction must 409."""
    db, sport_id, team_ids = make_db("single_elimination", 4)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                    match_duration_minutes=DUR)

    rows = db.rows("matches")
    r1 = [m for m in rows if m["match_round"] == 1]
    final = next(m for m in rows if m["match_round"] == 2)

    w1 = r1[0]["home_team_id"]
    h.result(r1[0]["id"], w1)
    w2 = r1[1]["home_team_id"]
    h.result(r1[1]["id"], w2)
    h.result(final["id"], w1)  # final has been played

    with pytest.raises(HTTPException) as exc:
        h.result(r1[0]["id"], r1[0]["away_team_id"])
    assert exc.value.status_code == 409
    assert_team_states_consistent(db.rows("matches"))


def test_correction_after_loser_auto_advanced_through_bye(monkeypatch):
    """Double-elim with a bye in the losers bracket: the loser of a WB R1 match
    auto-advances through an LB bye instantly. Correcting that WB result must
    cleanly pull the old loser back out of the losers bracket (or 409) —
    never leave the team in two places or strand the new loser."""
    db, sport_id, team_ids = make_db("double_elimination", 5)
    h = RouterHarness(db, monkeypatch)
    persist_bracket(sport_id, team_ids, db, location_ids=["c0"], start_time=START,
                    match_duration_minutes=DUR)

    rows = db.rows("matches")
    real_r1 = [
        m for m in rows
        if m["match_round"] == 1 and m["home_team_id"] and m["away_team_id"]
        and m["status"] == "scheduled"
    ]
    assert real_r1, "expected a real WB R1 match in a 5-team double-elim"
    m = real_r1[0]
    home, away = m["home_team_id"], m["away_team_id"]

    h.result(m["id"], home)
    assert_team_states_consistent(db.rows("matches"))

    try:
        h.result(m["id"], away)
    except HTTPException as exc:
        assert exc.status_code == 409
    assert_team_states_consistent(db.rows("matches"))
