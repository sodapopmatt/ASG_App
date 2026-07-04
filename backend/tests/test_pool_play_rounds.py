"""Truncated round robin (sports.pool_play_rounds) exercised through the full
generate-bracket pipeline: cohort court scheduling, standings, and the bracket
phase — not just the isolated generate_round_robin() unit, which already has
its own tests in test_pools.py."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.routers.matches import _compute_estimated_starts

from fake_db import FakeSupabase
from router_harness import RouterHarness
from invariants import assert_no_court_overlap, assert_team_states_consistent
from test_pools import make_pool_sport

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 25


def _games_by_team(matches, team_ids):
    games = {t: [] for t in team_ids}
    for m in matches:
        games[m["home_team_id"]].append(m["away_team_id"])
        games[m["away_team_id"]].append(m["home_team_id"])
    return games


@pytest.mark.parametrize("pool_size,rounds", [(4, 2), (6, 2), (6, 3), (8, 3), (5, 2), (7, 3)])
def test_truncated_pool_through_full_pipeline(pool_size, rounds, monkeypatch):
    """Each team plays at most `rounds` distinct opponents, never a repeat,
    through the real generate-bracket endpoint (not the bare generator)."""
    db, sport_id, pools = make_pool_sport([pool_size], pool_play_rounds=rounds)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    rows = db.rows("matches")
    assert max(m["match_round"] for m in rows) <= rounds

    games = _games_by_team(rows, pools[0].team_ids)
    for t, opponents in games.items():
        assert len(opponents) <= rounds, f"{t} played {len(opponents)} games, cap is {rounds}"
        assert len(set(opponents)) == len(opponents), f"{t} faced a repeat opponent: {opponents}"

    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    assert_no_court_overlap(rows, est, DUR)
    for m in rows:
        assert est.get(m["id"]) is not None, "every truncated pool match should still get a time"


def test_pool_play_rounds_none_is_full_round_robin(monkeypatch):
    """Explicit pool_play_rounds=None (not just omitted) must not truncate —
    regression for the DB read wiring in _generate_pool_play."""
    from itertools import combinations

    db, sport_id, pools = make_pool_sport([5], pool_play_rounds=None)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    rows = db.rows("matches")
    pairs = {frozenset((m["home_team_id"], m["away_team_id"])) for m in rows}
    assert pairs == {frozenset(p) for p in combinations(pools[0].team_ids, 2)}


def test_pool_play_rounds_exceeding_natural_falls_back_to_full(monkeypatch):
    """pool_play_rounds larger than the natural round count yields a full
    round robin (not an error, not a truncated-looking partial schedule)."""
    from itertools import combinations

    db, sport_id, pools = make_pool_sport([4], pool_play_rounds=99)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    rows = db.rows("matches")
    pairs = {frozenset((m["home_team_id"], m["away_team_id"])) for m in rows}
    assert pairs == {frozenset(p) for p in combinations(pools[0].team_ids, 2)}


def test_pool_play_rounds_zero_rejected_cleanly(monkeypatch):
    """An invalid pool_play_rounds (0 or negative) must 422, not 500 — the
    frontend always converts 0/blank to null, but a sport could still be
    PATCHed directly to an invalid value."""
    db, sport_id, pools = make_pool_sport([4], pool_play_rounds=0)
    h = RouterHarness(db, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, pools=pools)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("pool_sizes,rounds,courts_per_pool", [
    ([6, 6], 2, 2),
    ([5, 7], 2, 2),
    ([4, 6, 8], 3, 1),
])
def test_truncated_multi_pool_cohort_scheduling(pool_sizes, rounds, courts_per_pool, monkeypatch):
    """Cohort scheduling (multiple pools sharing/each owning courts) must stay
    collision-free and fully scheduled when every pool is independently
    truncated — this exercises the mpr/field-pairing math in persist_pools
    against a truncated (not full) round count per pool."""
    db, sport_id, pools = make_pool_sport(pool_sizes, courts_per_pool=courts_per_pool, pool_play_rounds=rounds)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    rows = db.rows("matches")
    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    assert_no_court_overlap(rows, est, DUR)
    for m in rows:
        assert est.get(m["id"]) is not None

    brackets = {b["id"]: b["name"] for b in db.rows("brackets")}
    for p in pools:
        pool_matches = [m for m in rows if brackets.get(m["bracket_id"]) == p.name]
        assert max((m["match_round"] for m in pool_matches), default=0) <= rounds
        games = _games_by_team(pool_matches, p.team_ids)
        for t, opponents in games.items():
            assert len(opponents) <= rounds
            assert len(set(opponents)) == len(opponents)


def test_standings_correct_after_truncated_pool(monkeypatch):
    """W-L standings must be computed correctly from whatever terminal
    matches exist in a truncated pool — fewer games played, same logic."""
    db, sport_id, pools = make_pool_sport([4], pool_play_rounds=2)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)

    rows = db.rows("matches")
    assert len(rows) == 4  # 4 teams x 2 rounds / 2 per match = 4 matches total

    a, b, c, d = pools[0].team_ids
    for m in rows:
        h.result(m["id"], m["home_team_id"])

    standings = h.standings(sport_id)
    table = {row["team_id"]: row for row in standings[0]["standings"]}
    total_wins = sum(row["wins"] for row in table.values())
    total_losses = sum(row["losses"] for row in table.values())
    assert total_wins == len(rows)
    assert total_losses == len(rows)
    assert_team_states_consistent(db.rows("matches"))


def test_bracket_phase_generation_works_after_truncated_pools(monkeypatch):
    """The seeded elimination bracket phase must still generate correctly
    after a truncated (not full) pool stage."""
    db, sport_id, pools = make_pool_sport([4, 4], pool_play_rounds=2)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)
    pool_match_count = len(db.rows("matches"))

    seeds = [pools[0].team_ids[0], pools[1].team_ids[0],
             pools[0].team_ids[1], pools[1].team_ids[1]]
    h.generate(sport_id, team_ids=seeds)

    rows = db.rows("matches")
    assert len(rows) == pool_match_count + 3  # 4-team single elim adds 3 matches

    phases = {b["id"]: b["phase"] for b in db.rows("brackets")}
    bracket_matches = [m for m in rows if phases.get(m["bracket_id"]) == "bracket"]
    assert len(bracket_matches) == 3
