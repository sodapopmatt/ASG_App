"""Chaos coverage for pool play and division brackets — previously only
elimination brackets were chaos-tested. Pools have no advancement links (so
retraction/correction behaves differently) and truncated round robin adds a
new failure surface; divisions add cross-bracket championship wiring under
messy admin input."""

import random
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.bracket_engine.generator import persist_bracket

from fake_db import FakeSupabase
from router_harness import RouterHarness, DivisionSpec, PoolSpec
from invariants import assert_no_court_overlap, assert_team_states_consistent

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 20
TERMINAL = {"completed", "forfeit", "double_forfeit", "draw"}


def _check_pool_consistency(rows):
    """Pool-specific version of assert_team_states_consistent: a team is
    pre-scheduled for ALL its round-robin games upfront, so having several
    still-`scheduled` matches at once is normal (unlike elimination brackets).
    The only real impossibility is a team physically playing two matches at
    the same instant — i.e. appearing `in_progress` in more than one match."""
    in_progress_slot = {}
    for m in rows:
        if m["status"] in ("completed", "forfeit"):
            assert m["winner_id"] in (m["home_team_id"], m["away_team_id"])
        if m["status"] == "in_progress":
            for team in (m["home_team_id"], m["away_team_id"]):
                if team:
                    assert team not in in_progress_slot, (
                        f"team {team} is in_progress in two matches at once: "
                        f"{in_progress_slot[team]} and {m['id']}"
                    )
                    in_progress_slot[team] = m["id"]


def make_pool_sport(pool_sizes, pool_play_rounds=None, courts_per_pool=1):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Soccer", "bracket_type": "pool_bracket",
        "match_duration_minutes": DUR, "schedule_start": START.isoformat(),
        "pool_play_rounds": pool_play_rounds,
    }).execute().data[0]
    pools = []
    for p, size in enumerate(pool_sizes):
        courts = [
            db.table("locations").insert({"sport_id": sport["id"], "name": f"F{p}-{c}"}).execute().data[0]["id"]
            for c in range(courts_per_pool)
        ]
        team_ids = [
            db.table("teams").insert({
                "company_id": f"co-{p}-{i}", "sport_id": sport["id"], "name": f"P{p}T{i}",
            }).execute().data[0]["id"]
            for i in range(size)
        ]
        pools.append(PoolSpec(name=f"Pool {chr(65+p)}", team_ids=team_ids, location_ids=courts))
    return db, sport["id"], pools


@pytest.mark.parametrize("seed", [0, 1, 2])
@pytest.mark.parametrize("pool_sizes,rounds", [([5], None), ([4, 4], 2), ([5, 7], 3)])
def test_chaos_pool_play(pool_sizes, rounds, seed, monkeypatch):
    db, sport_id, pools = make_pool_sport(pool_sizes, pool_play_rounds=rounds)
    h = RouterHarness(db, monkeypatch)
    h.generate(sport_id, pools=pools)
    rng = random.Random(f"pool-{pool_sizes}-{rounds}-{seed}")

    max_iters = len(db.rows("matches")) * 3 + 20
    for _ in range(max_iters):
        rows = db.rows("matches")
        _check_pool_consistency(rows)

        playable = [m for m in rows if m["status"] == "scheduled"]
        if not playable:
            break

        m = rng.choice(playable)
        home, away = m["home_team_id"], m["away_team_id"]
        roll = rng.random()

        if roll < 0.5:
            h.result(m["id"], rng.choice([home, away]))
        elif roll < 0.65:
            h.forfeit(m["id"], rng.choice([home, away]))
        elif roll < 0.75:
            h.double_forfeit(m["id"])
        elif roll < 0.90:
            h.draw(m["id"])
        else:
            # Correction: pool matches have no downstream link, so a
            # correction must ALWAYS succeed cleanly (no 409 case exists)
            first, second = (home, away) if rng.random() < 0.5 else (away, home)
            h.result(m["id"], first)
            h.result(m["id"], second)  # must not raise
            _check_pool_consistency(db.rows("matches"))

    rows = db.rows("matches")
    assert all(m["status"] in TERMINAL for m in rows), "pool play left matches unresolved"

    # Standings must reflect exactly the terminal matches, with wins+losses+
    # draws consistent — no double counting, no team dropped
    standings = h.standings(sport_id)
    for pool_result in standings:
        for row in pool_result["standings"]:
            assert row["wins"] + row["losses"] + row["draws"] == row["played"]

    from app.routers.matches import _compute_estimated_starts
    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    assert_no_court_overlap(rows, est, DUR)


def make_basketball(n_per_division):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Basketball", "bracket_type": "double_elimination",
        "match_duration_minutes": DUR, "schedule_start": START.isoformat(),
    }).execute().data[0]
    divisions = []
    for d, div_name in enumerate(("North Gym", "Main Gym")):
        court = db.table("locations").insert({"sport_id": sport["id"], "name": div_name}).execute().data[0]["id"]
        team_ids = [
            db.table("teams").insert({
                "company_id": f"co-{d}-{i}", "sport_id": sport["id"], "name": f"D{d}T{i}",
            }).execute().data[0]["id"]
            for i in range(n_per_division)
        ]
        divisions.append(DivisionSpec(name=div_name, team_ids=team_ids, location_ids=[court]))
    return db, sport["id"], divisions


@pytest.mark.parametrize("seed", [0, 1, 2])
@pytest.mark.parametrize("n_per_division", [3, 4, 6])
def test_chaos_divisions_with_forfeits_and_corrections(n_per_division, seed, monkeypatch):
    """Division brackets under chaos: forfeits/double-forfeits/corrections
    must still resolve to exactly one champion via the championship match,
    and division/court isolation must survive throughout, not just at the end."""
    db, sport_id, divisions = make_basketball(n_per_division)
    h = RouterHarness(db, monkeypatch)
    result = h.generate(sport_id, divisions=divisions)
    champ_id = result["championship_match_id"]
    rng = random.Random(f"div-{n_per_division}-{seed}")

    team_division = {tid: d for d, div in enumerate(divisions) for tid in div.team_ids}
    bracket_division = {
        b["id"]: b["division"] for b in db.rows("brackets")
    }

    max_iters = len(db.rows("matches")) * 4 + 20
    for _ in range(max_iters):
        rows = db.rows("matches")
        assert_team_states_consistent(rows)

        # Division isolation must hold at every step, not just the end
        for m in rows:
            div = bracket_division.get(m["bracket_id"])
            if div is None:
                continue
            for team in (m["home_team_id"], m["away_team_id"]):
                if team:
                    assert divisions[team_division[team]].name == div, (
                        f"team {team} (division {team_division[team]}) appears in "
                        f"a {div} match {m['id']}"
                    )

        playable = [
            m for m in rows
            if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
        ]
        if not playable:
            break

        m = rng.choice(playable)
        home, away = m["home_team_id"], m["away_team_id"]
        roll = rng.random()

        if roll < 0.6:
            h.result(m["id"], rng.choice([home, away]))
        elif roll < 0.75:
            h.forfeit(m["id"], rng.choice([home, away]))
        elif roll < 0.85:
            h.double_forfeit(m["id"])
        else:
            first, second = (home, away) if rng.random() < 0.5 else (away, home)
            h.result(m["id"], first)
            try:
                h.result(m["id"], second)
            except HTTPException as exc:
                assert exc.status_code == 409

    rows = db.rows("matches")
    assert all(m["status"] in TERMINAL for m in rows), "division tournament left matches unresolved"

    champ = next(m for m in rows if m["id"] == champ_id)
    assert champ["status"] in TERMINAL
    if champ["status"] != "double_forfeit":
        assert champ["winner_id"] is not None
        # Championship's two teams must come from different divisions
        w_div = team_division.get(champ["home_team_id"])
        l_div = team_division.get(champ["away_team_id"])
        if w_div is not None and l_div is not None:
            assert w_div != l_div
