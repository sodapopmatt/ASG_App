"""Regression tests for validation gaps found in the general bug scout:
short_id format, award-placement bounds, and duplicate team names on update."""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.company import CompanyCreate, CompanyUpdate
from app.auth import require_admin

from fake_db import FakeSupabase
import app.routers.event_points as event_points_router
import app.routers.teams as teams_router
from app.schemas.team import TeamUpdate


def _client_for(router, db, monkeypatch):
    """A minimal app around one router so Query()-declared constraints (e.g.
    ge=1) are actually enforced by FastAPI's request parsing — calling a
    router function directly bypasses that layer entirely."""
    import app.database as database_module
    monkeypatch.setattr(database_module, "supabase", db)
    monkeypatch.setattr(router, "supabase", db)
    app = FastAPI()
    app.include_router(router.router, prefix="/x")
    app.dependency_overrides[require_admin] = lambda: {"role": "admin"}
    return TestClient(app)


def test_short_id_rejects_bad_format():
    with pytest.raises(ValidationError):
        CompanyCreate(name="Acme", short_id="lowercase!")
    with pytest.raises(ValidationError):
        CompanyUpdate(short_id="has spaces")


def test_short_id_required_on_create():
    with pytest.raises(ValidationError):
        CompanyCreate(name="Acme")  # short_id is required, no default


def test_short_id_accepts_valid_format():
    c = CompanyCreate(name="Acme", short_id="ACME-1")
    assert c.short_id == "ACME-1"


def test_award_placement_rejects_zero_and_negative(monkeypatch):
    db = FakeSupabase()
    client = _client_for(event_points_router, db, monkeypatch)
    sport = db.table("sports").insert({"name": "S", "points_scale": None}).execute().data[0]
    company = db.table("companies").insert({"name": "C", "short_id": "C-1"}).execute().data[0]

    resp = client.post(f"/x/award-placement?company_id={company['id']}&sport_id={sport['id']}&placement=0")
    assert resp.status_code == 422

    resp = client.post(f"/x/award-placement?company_id={company['id']}&sport_id={sport['id']}&placement=-1")
    assert resp.status_code == 422

    resp = client.post(f"/x/award-placement?company_id={company['id']}&sport_id={sport['id']}&placement=1")
    assert resp.status_code == 200


def test_award_placement_rejects_unknown_company(monkeypatch):
    db = FakeSupabase()
    client = _client_for(event_points_router, db, monkeypatch)
    sport = db.table("sports").insert({"name": "S", "points_scale": None}).execute().data[0]

    resp = client.post(f"/x/award-placement?company_id=nonexistent&sport_id={sport['id']}&placement=1")
    assert resp.status_code == 404


def test_update_team_rejects_duplicate_name(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(teams_router, "supabase", db)
    sport = db.table("sports").insert({"name": "S"}).execute().data[0]
    t1 = db.table("teams").insert({
        "company_id": "co-1", "sport_id": sport["id"], "name": "Alpha",
    }).execute().data[0]
    t2 = db.table("teams").insert({
        "company_id": "co-1", "sport_id": sport["id"], "name": "Beta",
    }).execute().data[0]

    with pytest.raises(HTTPException) as exc:
        teams_router.update_team(t2["id"], TeamUpdate(name="Alpha"))
    assert exc.value.status_code == 422

    # Renaming to its own current name, or a name in a different sport, is fine
    teams_router.update_team(t1["id"], TeamUpdate(name="Alpha"))
    t3 = db.table("teams").insert({
        "company_id": "co-1", "sport_id": "other-sport", "name": "Alpha",
    }).execute().data[0]
    teams_router.update_team(t3["id"], TeamUpdate(name="Alpha"))
