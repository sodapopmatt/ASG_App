"""Regression coverage for a real bug reported live: clearing a nullable
field via PATCH (e.g. Pickleball's "Games per team" back to blank/full round
robin) silently did nothing. Root cause was `model_dump(exclude_none=True)`
on five different PATCH endpoints — that drops any field the caller
explicitly sent as null, indistinguishable from a field never mentioned at
all. The fix is `exclude_unset=True`, which only drops fields absent from the
request body, correctly applying an explicit null as "clear this field"."""

import app.routers.sports as sports_router
import app.routers.companies as companies_router
import app.routers.teams as teams_router
import app.routers.matches as matches_router
import app.routers.brackets as brackets_router
from app.schemas.sport import SportUpdate
from app.schemas.company import CompanyUpdate
from app.schemas.team import TeamUpdate
from app.schemas.match import MatchUpdate
from app.schemas.bracket import BracketUpdate

from fake_db import FakeSupabase


def test_sport_update_clears_pool_play_rounds_to_null(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport = db.table("sports").insert({"name": "Pickleball", "pool_play_rounds": 7}).execute().data[0]

    sports_router.update_sport(sport["id"], SportUpdate(pool_play_rounds=None))

    row = db.table("sports").select("*").eq("id", sport["id"]).execute().data[0]
    assert row["pool_play_rounds"] is None


def test_sport_update_still_leaves_untouched_fields_alone(monkeypatch):
    """exclude_unset must not become 'clear everything not sent as a value' —
    fields never mentioned in the request stay exactly as they were."""
    db = FakeSupabase()
    monkeypatch.setattr(sports_router, "supabase", db)
    sport = db.table("sports").insert({
        "name": "Pickleball", "pool_play_rounds": 7, "venue": "Court Complex",
    }).execute().data[0]

    sports_router.update_sport(sport["id"], SportUpdate(match_duration_minutes=30))

    row = db.table("sports").select("*").eq("id", sport["id"]).execute().data[0]
    assert row["match_duration_minutes"] == 30
    assert row["pool_play_rounds"] == 7  # untouched, not wiped
    assert row["venue"] == "Court Complex"  # untouched, not wiped


def test_company_update_clears_logo_url(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(companies_router, "supabase", db)
    company = db.table("companies").insert({
        "name": "Acme", "short_id": "ACME", "logo_url": "https://example.com/logo.png",
    }).execute().data[0]

    companies_router.update_company(company["id"], CompanyUpdate(logo_url=None))

    row = db.table("companies").select("*").eq("id", company["id"]).execute().data[0]
    assert row["logo_url"] is None
    assert row["name"] == "Acme"  # untouched


def test_team_update_clears_custom_name(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(teams_router, "supabase", db)
    team = db.table("teams").insert({
        "company_id": "co-1", "sport_id": "sport-1", "name": "Custom Name",
    }).execute().data[0]

    teams_router.update_team(team["id"], TeamUpdate(name=None))

    row = db.table("teams").select("*").eq("id", team["id"]).execute().data[0]
    assert row["name"] is None


def test_match_update_clears_scores(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    match = db.table("matches").insert({
        "sport_id": "s1", "home_score": 4, "away_score": 2,
    }).execute().data[0]

    matches_router.update_match(match["id"], MatchUpdate(home_score=None, away_score=None))

    row = db.table("matches").select("*").eq("id", match["id"]).execute().data[0]
    assert row["home_score"] is None
    assert row["away_score"] is None


def test_bracket_update_clears_phase(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(brackets_router, "supabase", db)
    bracket = db.table("brackets").insert({
        "sport_id": "s1", "name": "Main Gym — Winners", "phase": "winners",
    }).execute().data[0]

    brackets_router.update_bracket(bracket["id"], BracketUpdate(phase=None))

    row = db.table("brackets").select("*").eq("id", bracket["id"]).execute().data[0]
    assert row["phase"] is None
    assert row["name"] == "Main Gym — Winners"  # untouched
