"""Water Ball Toss scoring: real per-team matches (bracket_type='heats'),
with rounds survived entered via the generic heat-result mechanism (stored
in matches.notes) and each company's score taken as the best of its own
teams, ranked and awarded the sport's placement scale (ties sharing points)."""

import pytest
from fastapi import HTTPException

import app.routers.waterball_results as wr
from fake_db import FakeSupabase


@pytest.fixture
def db(monkeypatch):
    d = FakeSupabase()
    monkeypatch.setattr(wr, "supabase", d)
    return d


def _make_sport(db, **overrides):
    payload = {"name": "Water Ball Toss", "bracket_type": "heats", "scoring_mode": "water_ball_toss", "points_scale": None}
    payload.update(overrides)
    return db.table("sports").insert(payload).execute().data[0]["id"]


def _make_team(db, sport_id, company_id):
    return db.table("teams").insert({"sport_id": sport_id, "company_id": company_id}).execute().data[0]["id"]


def _make_match(db, sport_id, team_id, status="scheduled", notes=None):
    return db.table("matches").insert({
        "sport_id": sport_id,
        "home_team_id": team_id,
        "away_team_id": None,
        "status": status,
        "notes": notes,
    }).execute().data[0]["id"]


def _recompute(sport_id):
    return wr.recompute_for_sport(sport_id)


def test_points_are_rounds_survived_plus_one(db):
    sport_id = _make_sport(db)
    team_id = _make_team(db, sport_id, "company-1")
    _make_match(db, sport_id, team_id, status="completed", notes="5")
    _recompute(sport_id)

    points = db.rows("event_points")
    assert len(points) == 1
    assert points[0]["company_id"] == "company-1"
    assert points[0]["placement"] == 1
    assert points[0]["points"] == 40  # sole company -> 1st place ASG scale


def test_forfeit_scores_zero_and_ranks_last(db):
    sport_id = _make_sport(db)
    team_a = _make_team(db, sport_id, "company-a")
    team_b = _make_team(db, sport_id, "company-b")
    _make_match(db, sport_id, team_a, status="completed", notes="3")  # 4 pts
    _make_match(db, sport_id, team_b, status="forfeit")               # 0 pts, no-show
    _recompute(sport_id)

    points = {p["company_id"]: p for p in db.rows("event_points")}
    assert points["company-a"]["placement"] == 1
    assert points["company-a"]["points"] == 40
    assert points["company-b"]["placement"] == 2
    assert points["company-b"]["points"] == 38


def test_company_score_is_best_of_its_teams(db):
    """A company fielding multiple teams is ranked by whichever team went furthest."""
    sport_id = _make_sport(db)
    weak = _make_team(db, sport_id, "company-a")
    strong = _make_team(db, sport_id, "company-a")
    other = _make_team(db, sport_id, "company-b")
    _make_match(db, sport_id, weak, status="completed", notes="0")     # 1 pt
    _make_match(db, sport_id, strong, status="completed", notes="6")   # 7 pts -> company-a's score
    _make_match(db, sport_id, other, status="completed", notes="2")    # 3 pts
    _recompute(sport_id)

    points = {p["company_id"]: p for p in db.rows("event_points")}
    assert points["company-a"]["placement"] == 1
    assert points["company-b"]["placement"] == 2


def test_tied_companies_share_averaged_points(db):
    sport_id = _make_sport(db)
    team_a = _make_team(db, sport_id, "company-a")
    team_b = _make_team(db, sport_id, "company-b")
    team_c = _make_team(db, sport_id, "company-c")
    _make_match(db, sport_id, team_a, status="completed", notes="4")  # 5 pts
    _make_match(db, sport_id, team_b, status="completed", notes="4")  # 5 pts, tied with a for 1st
    _make_match(db, sport_id, team_c, status="completed", notes="1")  # 2 pts -> 3rd
    _recompute(sport_id)

    points = {p["company_id"]: p for p in db.rows("event_points")}
    # tied for 1st/2nd -> average of 40 and 38
    assert points["company-a"]["placement"] == 1
    assert points["company-a"]["points"] == 39
    assert points["company-b"]["placement"] == 1
    assert points["company-b"]["points"] == 39
    assert points["company-c"]["placement"] == 3
    assert points["company-c"]["points"] == 36


def test_matches_without_an_entered_result_are_excluded_from_ranking(db):
    sport_id = _make_sport(db)
    scored = _make_team(db, sport_id, "company-a")
    unscored = _make_team(db, sport_id, "company-b")
    _make_match(db, sport_id, scored, status="completed", notes="1")
    _make_match(db, sport_id, unscored, status="scheduled")  # not played yet
    _recompute(sport_id)

    points = db.rows("event_points")
    assert len(points) == 1
    assert points[0]["company_id"] == "company-a"


def test_double_forfeit_scores_zero_like_forfeit(db):
    """The generic /matches/{id}/double-forfeit endpoint has no bracket_type
    guard, so a water-ball match could end up in that status even though the
    UI only ever uses single-team forfeit; it must still score 0, not be
    silently excluded from ranking like an unplayed match."""
    sport_id = _make_sport(db)
    team_a = _make_team(db, sport_id, "company-a")
    team_b = _make_team(db, sport_id, "company-b")
    _make_match(db, sport_id, team_a, status="completed", notes="2")  # 3 pts
    _make_match(db, sport_id, team_b, status="double_forfeit")
    _recompute(sport_id)

    points = {p["company_id"]: p for p in db.rows("event_points")}
    assert points["company-a"]["placement"] == 1
    assert points["company-b"]["placement"] == 2
    assert points["company-b"]["points"] == 38


def test_recompute_rejected_for_non_water_ball_sport(db):
    sport_id = _make_sport(db, scoring_mode="placement")
    with pytest.raises(HTTPException) as exc:
        _recompute(sport_id)
    assert exc.value.status_code == 422
