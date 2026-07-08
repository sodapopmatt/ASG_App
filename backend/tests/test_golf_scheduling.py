"""Executive Golf is bracket_type='heats' but, unlike every other heats sport
(Relay Race, Human Pyramid, Water Ball Toss), companies tee off individually
rather than starting simultaneously as a group. _attach_estimated_starts must
NOT treat its bracket as a concurrent heat, so matches get staggered by
match_duration_minutes via the normal per-court ripple instead of collapsing
onto one shared start time."""

from datetime import datetime, timedelta, timezone

import app.routers.matches as matches_router
from fake_db import FakeSupabase
from router_harness import RouterHarness, HeatSpec

START = datetime(2026, 7, 4, 9, 0, tzinfo=timezone.utc)
DUR = 3


def make_golf_sport(n_teams, scoring_mode="executive_golf"):
    db = FakeSupabase()
    sport = db.table("sports").insert({
        "name": "Executive Golf",
        "bracket_type": "heats",
        "scoring_mode": scoring_mode,
        "match_duration_minutes": DUR,
        "schedule_start": START.isoformat(),
    }).execute().data[0]
    db.table("locations").insert({"sport_id": sport["id"], "name": "Tee 1"}).execute()
    team_ids = []
    for i in range(n_teams):
        team = db.table("teams").insert({
            "company_id": f"company-{i}", "sport_id": sport["id"],
        }).execute().data[0]
        team_ids.append(team["id"])
    return db, sport["id"], team_ids


def test_golf_matches_get_distinct_scheduled_at_not_one_shared_value(monkeypatch):
    """Every other heats sport stores ONE scheduled_at for the whole heat (they
    race simultaneously). Golf must store a DISTINCT scheduled_at per company,
    staggered by duration — otherwise estimated_start (staggered by the ripple)
    diverges from the stored scheduled_at and every match after the first gets
    incorrectly flagged as "pushed" on the schedule, even with nothing delayed."""
    db, sport_id, team_ids = make_golf_sport(4)
    h = RouterHarness(db, monkeypatch)

    h.generate(sport_id, heats=[HeatSpec(name="Round 1", team_ids=team_ids, phase="heats")])

    scheduled = sorted(m["scheduled_at"] for m in db.rows("matches"))
    assert len(set(scheduled)) == 4, "each company must get its own stored scheduled_at"
    for i in range(1, 4):
        gap = datetime.fromisoformat(scheduled[i]) - datetime.fromisoformat(scheduled[i - 1])
        assert gap == timedelta(minutes=DUR)

    # estimated_start should exactly match the stored scheduled_at under normal
    # conditions — no artificial "pushed" divergence from generation alone.
    annotated = matches_router._attach_estimated_starts(db.rows("matches"))
    for m in annotated:
        assert m["estimated_start"].isoformat() == m["scheduled_at"] or \
            m["estimated_start"] == datetime.fromisoformat(m["scheduled_at"])


def test_golf_round_matches_are_staggered_by_duration(monkeypatch):
    db, sport_id, team_ids = make_golf_sport(5)
    h = RouterHarness(db, monkeypatch)

    result = h.generate(sport_id, heats=[HeatSpec(name="Round 1", team_ids=team_ids, phase="heats")])
    assert result["matches_created"] == 5

    annotated = matches_router._attach_estimated_starts(db.rows("matches"))
    starts = sorted(m["estimated_start"] for m in annotated)

    assert len(set(starts)) == 5, "each company must get its own tee time, not a shared one"
    for i in range(1, 5):
        assert starts[i] - starts[i - 1] == timedelta(minutes=DUR)


def test_other_heats_sports_still_share_one_concurrent_start(monkeypatch):
    """Control case: a genuinely concurrent heats sport (e.g. Water Ball Toss)
    must be unaffected by the golf carve-out."""
    db, sport_id, team_ids = make_golf_sport(4, scoring_mode="water_ball_toss")
    h = RouterHarness(db, monkeypatch)

    h.generate(sport_id, heats=[HeatSpec(name="Group A", team_ids=team_ids, phase="heats")])

    annotated = matches_router._attach_estimated_starts(db.rows("matches"))
    starts = {m["estimated_start"] for m in annotated}
    assert len(starts) == 1, "a concurrent heat's entries must all share one start"
