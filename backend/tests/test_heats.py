"""Heats sports: grouped multi-phase heats (Relay Race) and flat entries
(Human Pyramid), including the concurrent-timing rule — all entries in one
heat share a start time and consume exactly one court slot."""

from datetime import datetime, timedelta, timezone

import pytest

from app.routers.matches import _compute_estimated_starts

from fake_db import FakeSupabase
from router_harness import RouterHarness, HeatSpec

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 15


def make_heats_sport(n_teams, n_locations=1):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Relay Race",
        "bracket_type": "heats",
        "match_duration_minutes": DUR,
        "schedule_start": START.isoformat(),
    }).execute().data[0]
    for c in range(n_locations):
        db.table("locations").insert({
            "sport_id": sport["id"], "name": f"Track {c}",
        }).execute()
    team_ids = []
    for i in range(n_teams):
        team = db.table("teams").insert({
            "company_id": f"company-{i}",
            "sport_id": sport["id"],
            "name": f"T{i}",
        }).execute().data[0]
        team_ids.append(team["id"])
    return db, sport["id"], team_ids


def heats_estimates(db, sport_id):
    rows = db.rows("matches")
    heats_bracket_ids = {b["id"] for b in db.rows("brackets")}
    est = _compute_estimated_starts(
        rows, {sport_id: DUR}, {sport_id: START}, heats_bracket_ids
    )
    return rows, est


def test_grouped_heats_structure_and_timing(monkeypatch):
    """Two prelim heats: one bracket per heat, one match per team, every match
    in a heat shares the same start, heats run one slot apart."""
    db, sport_id, team_ids = make_heats_sport(8)
    h = RouterHarness(db, monkeypatch)

    result = h.generate(sport_id, heats=[
        HeatSpec(name="Heat 1", team_ids=team_ids[:4], phase="heats"),
        HeatSpec(name="Heat 2", team_ids=team_ids[4:], phase="heats"),
    ])
    assert result["matches_created"] == 8

    brackets = db.rows("brackets")
    assert len(brackets) == 2
    assert all(b["phase"] == "heats" for b in brackets)

    rows, est = heats_estimates(db, sport_id)
    by_bracket = {}
    for m in rows:
        by_bracket.setdefault(m["bracket_id"], []).append(m)
    assert all(len(ms) == 4 for ms in by_bracket.values())

    heat_starts = []
    for bracket_id, ms in by_bracket.items():
        starts = {est[m["id"]] for m in ms}
        assert len(starts) == 1, "all entries in a heat must share one start"
        heat_starts.append(starts.pop())
    heat_starts.sort()
    assert heat_starts[1] - heat_starts[0] == timedelta(minutes=DUR), (
        "each heat occupies exactly one duration slot"
    )


def test_grouped_heats_multi_phase(monkeypatch):
    """Prelims then a final: phases live in their own brackets and the final
    is scheduled at its explicit time."""
    db, sport_id, team_ids = make_heats_sport(8)
    h = RouterHarness(db, monkeypatch)

    h.generate(sport_id, heats=[
        HeatSpec(name="Prelim 1", team_ids=team_ids[:4], phase="heats"),
        HeatSpec(name="Prelim 2", team_ids=team_ids[4:], phase="heats"),
    ])
    final_time = (START + timedelta(hours=2)).isoformat()
    h.generate(sport_id, heats=[
        HeatSpec(name="Final", team_ids=team_ids[:3] + team_ids[4:7],
                 phase="finals", scheduled_at=final_time),
    ])

    brackets = {b["name"]: b for b in db.rows("brackets")}
    assert brackets["Final"]["phase"] == "finals"

    final_matches = [
        m for m in db.rows("matches") if m["bracket_id"] == brackets["Final"]["id"]
    ]
    assert len(final_matches) == 6
    assert all(m["scheduled_at"] == final_time for m in final_matches)


def test_flat_heats_rounds_by_location_count(monkeypatch):
    """Human Pyramid style: one entry per team, no brackets; with 2 locations,
    teams go 2 per round."""
    db, sport_id, team_ids = make_heats_sport(6, n_locations=2)
    h = RouterHarness(db, monkeypatch)

    result = h.generate(sport_id, team_ids=team_ids)
    assert result["matches_created"] == 6

    assert db.rows("brackets") == []
    rows = db.rows("matches")
    assert all(m["bracket_id"] is None for m in rows)
    assert all(m["away_team_id"] is None for m in rows)

    rounds = {}
    for m in rows:
        rounds.setdefault(m["match_round"], []).append(m)
    assert {r: len(ms) for r, ms in rounds.items()} == {1: 2, 2: 2, 3: 2}

    # Rounds are one slot apart
    r1_time = rounds[1][0]["scheduled_at"]
    r2_time = rounds[2][0]["scheduled_at"]
    assert datetime.fromisoformat(r2_time) - datetime.fromisoformat(r1_time) == timedelta(minutes=DUR)
