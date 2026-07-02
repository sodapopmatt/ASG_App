"""Pool play (Soccer / Ultimate Frisbee / Pickleball): round-robin generation,
cohort court scheduling, W-L standings, and the seeded bracket phase."""

from datetime import datetime, timezone
from itertools import combinations

import pytest
from fastapi import HTTPException

from app.routers.matches import _compute_estimated_starts

from fake_db import FakeSupabase
from router_harness import RouterHarness, PoolSpec
from invariants import assert_no_court_overlap, assert_team_states_consistent

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 25


def make_pool_sport(pool_sizes, courts_per_pool=1, bracket_type="pool_bracket"):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Soccer",
        "bracket_type": bracket_type,
        "match_duration_minutes": DUR,
        "schedule_start": START.isoformat(),
    }).execute().data[0]
    pools = []
    for p, size in enumerate(pool_sizes):
        court_ids = []
        for c in range(courts_per_pool):
            loc = db.table("locations").insert({
                "sport_id": sport["id"], "name": f"Field {p}-{c}",
            }).execute().data[0]
            court_ids.append(loc["id"])
        team_ids = []
        for i in range(size):
            team = db.table("teams").insert({
                "company_id": f"company-{p}-{i}",
                "sport_id": sport["id"],
                "name": f"P{p}T{i}",
            }).execute().data[0]
            team_ids.append(team["id"])
        pools.append(PoolSpec(name=f"Pool {chr(65 + p)}", team_ids=team_ids, location_ids=court_ids))
    return db, sport["id"], pools


@pytest.mark.parametrize("pool_sizes", [[3], [4], [5], [4, 4], [3, 4, 5], [6, 6]])
def test_pool_round_robin_complete(pool_sizes, monkeypatch):
    """Every pair in a pool plays exactly once; no cross-pool matches."""
    db, sport_id, pools = make_pool_sport(pool_sizes)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    brackets = {b["name"]: b["id"] for b in db.rows("brackets")}
    rows = db.rows("matches")

    for p in pools:
        bracket_id = brackets[p.name]
        pool_matches = [m for m in rows if m["bracket_id"] == bracket_id]
        expected_pairs = set(frozenset(pair) for pair in combinations(p.team_ids, 2))
        actual_pairs = set(
            frozenset((m["home_team_id"], m["away_team_id"])) for m in pool_matches
        )
        assert actual_pairs == expected_pairs, f"{p.name}: round robin incomplete or has extras"
        # no team from outside this pool
        pool_set = set(p.team_ids)
        for m in pool_matches:
            assert m["home_team_id"] in pool_set and m["away_team_id"] in pool_set

    # schedule invariants
    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    assert_no_court_overlap(rows, est, DUR)
    for m in rows:
        assert est.get(m["id"]) is not None, "every pool match should have a time"


def test_pool_standings_after_results(monkeypatch):
    """Play a 4-team pool with a known outcome and verify W/D/L and ranks."""
    db, sport_id, pools = make_pool_sport([4])
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    a, b, c, d = pools[0].team_ids
    rows = db.rows("matches")

    def match_between(x, y):
        return next(
            m for m in rows
            if {m["home_team_id"], m["away_team_id"]} == {x, y}
        )

    # a beats everyone; b beats c and d; c draws... c vs d is a draw
    h.result(match_between(a, b)["id"], a)
    h.result(match_between(a, c)["id"], a)
    h.result(match_between(a, d)["id"], a)
    h.result(match_between(b, c)["id"], b)
    h.forfeit(match_between(b, d)["id"], d)  # d forfeits to b
    h.draw(match_between(c, d)["id"])

    standings = h.standings(sport_id)
    assert len(standings) == 1
    table = {row["team_id"]: row for row in standings[0]["standings"]}

    assert table[a]["wins"] == 3 and table[a]["losses"] == 0 and table[a]["rank"] == 1
    assert table[b]["wins"] == 2 and table[b]["losses"] == 1 and table[b]["rank"] == 2
    assert table[c]["wins"] == 0 and table[c]["draws"] == 1 and table[c]["losses"] == 2
    assert table[d]["wins"] == 0 and table[d]["draws"] == 1 and table[d]["losses"] == 2
    # c and d have identical records — they share the rank
    assert table[c]["rank"] == 3 and table[d]["rank"] == 3

    assert_team_states_consistent(db.rows("matches"))


def test_pool_bracket_standings_ignore_scores_on_ties(monkeypatch):
    """Locked V1 rule: pool_bracket sports (Soccer/Ultimate/Pickleball) rank by
    wins/losses only — ties are NOT broken by score. Two teams with identical
    records but very different scores must share a rank."""
    db, sport_id, pools = make_pool_sport([4])
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    a, b, c, d = pools[0].team_ids
    rows = db.rows("matches")

    def match_between(x, y):
        return next(m for m in rows if {m["home_team_id"], m["away_team_id"]} == {x, y})

    # a and b both go 2-1, but a's wins are blowouts (huge goal_diff) and b's
    # are narrow — under the old code this separated their rank, it must not.
    h.result(match_between(a, b)["id"], a, home_score=10, away_score=0)
    h.result(match_between(a, c)["id"], a, home_score=5, away_score=4)
    h.result(match_between(a, d)["id"], d, home_score=0, away_score=1)
    h.result(match_between(b, c)["id"], b, home_score=1, away_score=0)
    h.result(match_between(b, d)["id"], b, home_score=1, away_score=0)
    h.result(match_between(c, d)["id"], d, home_score=0, away_score=1)

    standings = h.standings(sport_id)
    table = {row["team_id"]: row for row in standings[0]["standings"]}

    assert table[a]["wins"] == 2 and table[b]["wins"] == 2
    assert table[a]["goal_diff"] != table[b]["goal_diff"]  # scores genuinely differ
    assert table[a]["rank"] == table[b]["rank"] == 1  # but rank ties anyway


def test_pool_swiss_standings_use_score_based_tiebreak(monkeypatch):
    """Cornhole (pool_swiss) is genuinely scored by points, so its ranking
    intentionally breaks ties by goal_diff — this is a deliberate exception
    to the pool_bracket no-score rule, not a violation of it."""
    db, sport_id, pools = make_pool_sport([4], bracket_type="pool_swiss")
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    a, b, c, d = pools[0].team_ids
    rows = db.rows("matches")

    def match_between(x, y):
        return next(m for m in rows if {m["home_team_id"], m["away_team_id"]} == {x, y})

    h.result(match_between(a, b)["id"], a, home_score=10, away_score=0)
    h.result(match_between(a, c)["id"], a, home_score=5, away_score=4)
    h.result(match_between(a, d)["id"], d, home_score=0, away_score=1)
    h.result(match_between(b, c)["id"], b, home_score=1, away_score=0)
    h.result(match_between(b, d)["id"], b, home_score=1, away_score=0)
    h.result(match_between(c, d)["id"], d, home_score=0, away_score=1)

    standings = h.standings(sport_id)
    table = {row["team_id"]: row for row in standings[0]["standings"]}

    assert table[a]["tournament_points"] == table[b]["tournament_points"]
    assert table[a]["rank"] != table[b]["rank"]  # goal_diff breaks the tie here


def test_draw_rejected_for_bracket_matches(monkeypatch):
    """Draws are pool-only: a match with advancement links must reject one."""
    from app.bracket_engine.generator import persist_bracket

    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Tug of War", "bracket_type": "single_elimination",
        "match_duration_minutes": DUR,
    }).execute().data[0]
    team_ids = [
        db.table("teams").insert({
            "company_id": f"co-{i}", "sport_id": sport["id"], "name": f"T{i}",
        }).execute().data[0]["id"]
        for i in range(4)
    ]
    persist_bracket(sport["id"], team_ids, db, location_ids=["c0"],
                    start_time=START, match_duration_minutes=DUR)
    h = RouterHarness(db, monkeypatch)

    r1 = next(m for m in db.rows("matches") if m["match_round"] == 1)
    with pytest.raises(HTTPException) as exc:
        h.draw(r1["id"])
    assert exc.value.status_code == 422


def test_bracket_phase_preserves_seed_order(monkeypatch):
    """After pools, generating the bracket phase with seeded team_ids must keep
    the seed order exactly (no same-company shuffling) and keep pool matches."""
    db, sport_id, pools = make_pool_sport([4, 4])
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)
    pool_match_count = len(db.rows("matches"))

    # Seed: pool winners first, then runners-up (as the frontend does)
    seeds = [pools[0].team_ids[0], pools[1].team_ids[0],
             pools[0].team_ids[1], pools[1].team_ids[1]]
    h.generate(sport_id, team_ids=seeds)

    rows = db.rows("matches")
    assert len(rows) == pool_match_count + 3  # 4-team single elim adds 3

    phases = {b["id"]: b["phase"] for b in db.rows("brackets")}
    bracket_r1 = [
        m for m in rows
        if phases.get(m["bracket_id"]) == "bracket" and m["match_round"] == 1
    ]
    # Standard seeding: 1 vs 4, 2 vs 3 — order preserved exactly
    pairs = {frozenset((m["home_team_id"], m["away_team_id"])) for m in bracket_r1}
    assert frozenset((seeds[0], seeds[3])) in pairs
    assert frozenset((seeds[1], seeds[2])) in pairs

    # Bracket phase starts after the last pool match
    pool_last = max(
        m["scheduled_at"] for m in rows if phases.get(m["bracket_id"]) == "pool"
    )
    bracket_first = min(m["scheduled_at"] for m in bracket_r1)
    assert bracket_first > pool_last


def test_bracket_phase_rejects_clear_existing(monkeypatch):
    db, sport_id, pools = make_pool_sport([4])
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, team_ids=pools[0].team_ids, clear_existing=True)
    assert exc.value.status_code == 422


def test_pool_generation_rejects_duplicate_court_across_pools(monkeypatch):
    """A court assigned to two pools must be rejected — otherwise both pools'
    matches can be scheduled on the same physical court simultaneously."""
    db, sport_id, pools = make_pool_sport([4, 4])
    h = RouterHarness(db, monkeypatch)
    shared_court = pools[0].location_ids[0]
    pools[1].location_ids = [shared_court]

    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, pools=pools)
    assert exc.value.status_code == 422


def test_pool_swiss_rejects_bracket_phase(monkeypatch):
    db, sport_id, pools = make_pool_sport([4], bracket_type="pool_swiss")
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, team_ids=pools[0].team_ids)
    assert exc.value.status_code == 422
