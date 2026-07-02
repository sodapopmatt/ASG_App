"""Basketball division split: two independent brackets on separate courts,
division finals feeding a single championship match."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from fake_db import FakeSupabase
from router_harness import RouterHarness, DivisionSpec
from invariants import assert_team_states_consistent

START = datetime(2026, 7, 4, 8, 0, tzinfo=timezone.utc)
DUR = 20
TERMINAL = {"completed", "forfeit", "double_forfeit"}


def make_basketball(n_per_division, sport_name="Basketball"):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": sport_name,
        "bracket_type": "double_elimination",
        "match_duration_minutes": DUR,
        "schedule_start": START.isoformat(),
    }).execute().data[0]
    courts = []
    for name in ("North", "Main"):
        loc = db.table("locations").insert({
            "sport_id": sport["id"], "name": name,
        }).execute().data[0]
        courts.append(loc["id"])
    divisions = []
    for d, (div_name, court) in enumerate(zip(("North Gym", "Main Gym"), courts)):
        team_ids = []
        for i in range(n_per_division):
            team = db.table("teams").insert({
                "company_id": f"company-{d}-{i}",
                "sport_id": sport["id"],
                "name": f"D{d}T{i}",
            }).execute().data[0]
            team_ids.append(team["id"])
        divisions.append(DivisionSpec(name=div_name, team_ids=team_ids, location_ids=[court]))
    return db, sport["id"], divisions


def play_until_done(h, db, sport_id):
    """Play every match (home always wins) until nothing is playable."""
    for _ in range(len(db.rows("matches")) * 4 + 20):
        assert_team_states_consistent(db.rows("matches"))
        playable = [
            m for m in db.rows("matches")
            if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
        ]
        if not playable:
            return
        h.result(playable[0]["id"], playable[0]["home_team_id"])
    pytest.fail("division tournament never resolved")


@pytest.mark.parametrize("n_per_division", [2, 3, 4, 6])
def test_division_generation_structure(n_per_division, monkeypatch):
    db, sport_id, divisions = make_basketball(n_per_division)
    h = RouterHarness(db, monkeypatch)

    result = h.generate(sport_id, divisions=divisions)
    assert result["championship_match_id"]

    brackets = db.rows("brackets")
    champ_brackets = [b for b in brackets if b["phase"] == "finals" and b["name"] == "Championship"]
    assert len(champ_brackets) == 1
    assert champ_brackets[0]["division"] is None

    # Every non-championship bracket is tagged with its division and name-prefixed
    for b in brackets:
        if b["id"] == champ_brackets[0]["id"]:
            continue
        assert b["division"] in ("North Gym", "Main Gym")
        assert b["name"].startswith(b["division"])

    # Each division's root feeds the championship; no other match does
    champ_id = result["championship_match_id"]
    feeders = [m for m in db.rows("matches") if m["winner_next_match_id"] == champ_id]
    assert len(feeders) == 2

    # Courts never cross divisions
    bracket_division = {b["id"]: b["division"] for b in brackets}
    court_by_division = {}
    for m in db.rows("matches"):
        div = bracket_division.get(m["bracket_id"])
        if div and m["location_id"]:
            court_by_division.setdefault(div, set()).add(m["location_id"])
    courts = list(court_by_division.values())
    assert len(courts) == 2 and not (courts[0] & courts[1])


@pytest.mark.parametrize("n_per_division", [2, 3, 4, 6])
def test_division_tournament_produces_single_champion(n_per_division, monkeypatch):
    db, sport_id, divisions = make_basketball(n_per_division)
    h = RouterHarness(db, monkeypatch)
    result = h.generate(sport_id, divisions=divisions)
    champ_id = result["championship_match_id"]

    play_until_done(h, db, sport_id)

    rows = db.rows("matches")
    assert all(m["status"] in TERMINAL for m in rows)

    champ = next(m for m in rows if m["id"] == champ_id)
    assert champ["status"] == "completed"
    assert champ["winner_id"] is not None
    # The championship pits one team from each division against the other
    team_division = {}
    for d_idx, d in enumerate(divisions):
        for tid in d.team_ids:
            team_division[tid] = d_idx
    assert team_division[champ["home_team_id"]] != team_division[champ["away_team_id"]]

    # The championship inherits a court from the first division that finished
    assert champ["location_id"] is not None


def test_divisions_rejected_for_non_basketball(monkeypatch):
    db, sport_id, divisions = make_basketball(4, sport_name="Volleyball")
    h = RouterHarness(db, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, divisions=divisions)
    assert exc.value.status_code == 422


def test_divisions_reject_team_in_two_divisions(monkeypatch):
    db, sport_id, divisions = make_basketball(4)
    divisions[1].team_ids[0] = divisions[0].team_ids[0]
    h = RouterHarness(db, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, divisions=divisions)
    assert exc.value.status_code == 422


def test_divisions_reject_single_division(monkeypatch):
    db, sport_id, divisions = make_basketball(4)
    h = RouterHarness(db, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        h.generate(sport_id, divisions=divisions[:1])
    assert exc.value.status_code == 422
