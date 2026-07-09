"""award-placement scoring rules: the default ASG scale floors at 2 (20th and
beyond all earn 2 points), ties average the tied places' values, and an explicit
points override may be negative (manual no-show deduction)."""

import pytest

import app.routers.event_points as ep
from fake_db import FakeSupabase


@pytest.fixture
def db(monkeypatch):
    d = FakeSupabase()
    monkeypatch.setattr(ep, "supabase", d)
    return d


def _make_sport(db, points_scale=None):
    return db.table("sports").insert({
        "name": "Test Sport",
        "bracket_type": "single_elimination",
        "points_scale": points_scale,
    }).execute().data[0]["id"]


def _make_company(db):
    return db.table("companies").insert({"name": "Acme", "short_id": "ACME"}).execute().data[0]["id"]


# ── _scale_points ──────────────────────────────────────────────────────────────

def test_default_scale_top_places():
    assert ep._scale_points(1, None) == 40
    assert ep._scale_points(2, None) == 38
    assert ep._scale_points(19, None) == 4


def test_default_scale_floors_at_two_from_twentieth():
    assert ep._scale_points(20, None) == 2
    assert ep._scale_points(21, None) == 2
    assert ep._scale_points(30, None) == 2


def test_custom_scale_overrides_default():
    scale = {"1": 20, "2": 15, "3": 10, "default": 5}
    assert ep._scale_points(1, scale) == 20
    assert ep._scale_points(4, scale) == 5
    assert ep._scale_points(25, scale) == 5


# ── _compute_points (ties) ─────────────────────────────────────────────────────

def test_three_way_tie_averages_the_tied_places():
    # tied for 5th through 7th -> (32 + 30 + 28) / 3 = 30
    assert ep._compute_points(5, None, tied_through=7) == 30


def test_tie_within_the_floor_stays_at_floor():
    assert ep._compute_points(20, None, tied_through=22) == 2


# ── award_placement endpoint ───────────────────────────────────────────────────

def test_deep_placement_earns_floor_points(db):
    sport_id = _make_sport(db)
    company_id = _make_company(db)
    row = ep.award_placement(company_id=company_id, sport_id=sport_id, placement=25, tied_through=None, points=None)
    assert row["points"] == 2
    assert row["placement"] == 25


def test_negative_points_override_is_accepted_and_persisted(db):
    sport_id = _make_sport(db)
    company_id = _make_company(db)
    row = ep.award_placement(company_id=company_id, sport_id=sport_id, placement=8, tied_through=None, points=-10)
    assert row["points"] == -10
    saved = db.rows("event_points")
    assert len(saved) == 1
    assert saved[0]["points"] == -10


def test_points_override_beats_scale_and_tied_through(db):
    sport_id = _make_sport(db)
    company_id = _make_company(db)
    row = ep.award_placement(company_id=company_id, sport_id=sport_id, placement=3, tied_through=4, points=25)
    assert row["points"] == 25
