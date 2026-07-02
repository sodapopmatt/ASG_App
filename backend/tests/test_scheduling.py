"""End-to-end scheduling invariants: generate real brackets through
persist_bracket against an in-memory DB, compute estimated starts with the real
read-time scheduler, and assert court/feeder/coverage invariants — then play
whole tournaments to completion and re-check at every step."""

from datetime import datetime, timezone

import pytest

from app.bracket_engine.generator import persist_bracket, advance_winner, settle_bracket
from app.routers.matches import _compute_estimated_starts

from fake_db import FakeSupabase
from invariants import (
    assert_no_court_overlap,
    assert_feeder_ordering,
    assert_all_scheduled_have_estimates,
    assert_court_load_balanced,
    is_bye_autocomplete,
)

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 30

TERMINAL = {"completed", "forfeit", "double_forfeit"}


def make_db(bracket_type, n_teams, teams_per_company=1):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Test Sport",
        "bracket_type": bracket_type,
        "match_duration_minutes": DUR,
    }).execute().data[0]
    team_ids = []
    for i in range(n_teams):
        team = db.table("teams").insert({
            "company_id": f"company-{i // teams_per_company}",
            "sport_id": sport["id"],
            "name": f"T{i}",
        }).execute().data[0]
        team_ids.append(team["id"])
    return db, sport["id"], team_ids


def estimates(db, sport_id):
    rows = db.rows("matches")
    est = _compute_estimated_starts(rows, {sport_id: DUR}, {sport_id: START})
    return rows, est


@pytest.mark.parametrize("bracket_type", ["single_elimination", "double_elimination"])
@pytest.mark.parametrize("n_courts", [1, 2, 3, 4])
@pytest.mark.parametrize("n_teams", range(2, 21))
def test_generation_schedule_invariants(bracket_type, n_teams, n_courts):
    db, sport_id, team_ids = make_db(bracket_type, n_teams)
    courts = [f"court-{c}" for c in range(n_courts)]

    persist_bracket(
        sport_id, team_ids, db,
        location_ids=courts, start_time=START, match_duration_minutes=DUR,
    )

    rows, est = estimates(db, sport_id)
    assert_no_court_overlap(rows, est, DUR)
    assert_feeder_ordering(rows, est, DUR)
    assert_all_scheduled_have_estimates(rows, est)


@pytest.mark.parametrize("bracket_type", ["single_elimination", "double_elimination"])
@pytest.mark.parametrize("n_courts", [1, 2, 3, 4])
@pytest.mark.parametrize("n_teams", range(2, 21))
def test_court_distribution(bracket_type, n_teams, n_courts):
    """Courts must share the load: round 1 spreads real matches evenly (byes
    count for nothing), the losers bracket spreads across all courts, and
    round 1 finishes as early as an even split allows."""
    from datetime import timedelta

    db, sport_id, team_ids = make_db(bracket_type, n_teams)
    courts = [f"court-{c}" for c in range(n_courts)]

    persist_bracket(
        sport_id, team_ids, db,
        location_ids=courts, start_time=START, match_duration_minutes=DUR,
    )

    rows = db.rows("matches")
    phases = {b["id"]: b["phase"] for b in db.rows("brackets")}

    wb_r1_real = [
        m for m in rows
        if phases.get(m["bracket_id"]) in ("winners", "bracket")
        and m["match_round"] == 1 and not is_bye_autocomplete(m)
    ]
    assert_court_load_balanced(wb_r1_real, n_courts)

    lb_all = [m for m in rows if phases.get(m["bracket_id"]) == "losers"]
    assert_court_load_balanced(lb_all, n_courts)

    # Round 1 must wrap up as early as an even split allows: with the real
    # matches spread evenly, the last one starts within ceil(count/courts) slots
    if wb_r1_real:
        import math
        slots_needed = math.ceil(len(wb_r1_real) / n_courts)
        last_start = max(_parse(m["scheduled_at"]) for m in wb_r1_real)
        assert last_start <= START + timedelta(minutes=(slots_needed - 1) * DUR), (
            f"round 1's last match starts at {last_start}; an even split across "
            f"{n_courts} courts finishes starting by slot {slots_needed - 1}"
        )


def _parse(value):
    from datetime import datetime
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.mark.parametrize("bracket_type", ["single_elimination", "double_elimination"])
@pytest.mark.parametrize("n_courts", [1, 2, 3])
@pytest.mark.parametrize("n_teams", [2, 3, 4, 5, 7, 8, 11, 16])
def test_full_tournament_progression(bracket_type, n_teams, n_courts):
    db, sport_id, team_ids = make_db(bracket_type, n_teams)
    courts = [f"court-{c}" for c in range(n_courts)]

    persist_bracket(
        sport_id, team_ids, db,
        location_ids=courts, start_time=START, match_duration_minutes=DUR,
    )

    max_iters = len(db.rows("matches")) * 3 + 10
    finished = False
    for _ in range(max_iters):
        rows, est = estimates(db, sport_id)
        assert_no_court_overlap(rows, est, DUR)
        assert_feeder_ordering(rows, est, DUR)

        playable = [
            m for m in rows
            if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
        ]
        if not playable:
            finished = True
            break

        # Play the earliest match; home team always wins (deterministic)
        playable.sort(key=lambda m: (est.get(m["id"]) is None, est.get(m["id"]) or START, m["id"]))
        m = playable[0]
        winner, loser = m["home_team_id"], m["away_team_id"]
        db.table("matches").update({
            "winner_id": winner, "status": "completed",
        }).eq("id", m["id"]).execute()
        advance_winner(m["id"], winner, loser, db)
        settle_bracket(sport_id, db)

    assert finished, "tournament never ran out of playable matches (deadlock or runaway)"

    rows = db.rows("matches")
    stuck = [m for m in rows if m["status"] not in TERMINAL]
    assert not stuck, f"{len(stuck)} matches never resolved: {[(m['match_round'], m['status']) for m in stuck]}"

    # Exactly one root match decides a single champion
    roots = [m for m in rows if m["winner_next_match_id"] is None]
    assert len(roots) == 1
    assert roots[0]["winner_id"] is not None

    # Loss caps: single elim = 1 loss max, double elim = 2 losses max
    max_losses = 1 if bracket_type == "single_elimination" else 2
    losses: dict[str, int] = {}
    for m in rows:
        if m["winner_id"] and m["home_team_id"] and m["away_team_id"]:
            loser = m["away_team_id"] if m["winner_id"] == m["home_team_id"] else m["home_team_id"]
            losses[loser] = losses.get(loser, 0) + 1
    for team, count in losses.items():
        assert count <= max_losses, f"team {team} lost {count} times in {bracket_type}"
