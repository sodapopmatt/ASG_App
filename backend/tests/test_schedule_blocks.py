"""Coverage for schedule blocks (lunch/photo blackout windows) in
_compute_estimated_starts: a not-yet-started match must never be estimated
to start or run into a block; it gets pushed to the block's end instead.
"""

from datetime import datetime, timedelta, timezone

from app.routers.matches import _compute_estimated_starts, _push_past_blocks

SPORT = "sport-1"
PHOTO_START = datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc)
PHOTO_END = datetime(2026, 7, 9, 12, 30, tzinfo=timezone.utc)
LUNCH_START = PHOTO_END
LUNCH_END = datetime(2026, 7, 9, 13, 0, tzinfo=timezone.utc)
BLOCKS = [(PHOTO_START, PHOTO_END), (LUNCH_START, LUNCH_END)]


def _match(mid, **kw):
    row = {
        "id": mid,
        "sport_id": SPORT,
        "bracket_id": None,
        "home_team_id": "t1",
        "away_team_id": "t2",
        "location_id": "north",
        "winner_id": None,
        "winner_next_match_id": None,
        "loser_next_match_id": None,
        "status": "scheduled",
        "match_round": 1,
        "scheduled_at": None,
        "actual_start": None,
        "home_slot_state": "tbd",
        "away_slot_state": "tbd",
    }
    row.update(kw)
    return row


def _compute(matches, duration=20, blocks=BLOCKS):
    return _compute_estimated_starts(matches, {SPORT: duration}, blocks=blocks)


def test_push_past_blocks_jumps_both_back_to_back_blocks():
    """A 20-minute match slated for 11:50 would end at 12:10, inside Photo
    (12:00-12:30). It must not stop at 12:30 either, since that instantly
    collides with Lunch (12:30-13:00) — it jumps straight to 1:00 PM."""
    start = datetime(2026, 7, 9, 11, 50, tzinfo=timezone.utc)
    pushed = _push_past_blocks(start, timedelta(minutes=20), BLOCKS)
    assert pushed == LUNCH_END


def test_match_ending_exactly_at_block_start_is_not_pushed():
    """A match starting at 11:40 (20 min) ends exactly at 12:00 — the half-open
    interval means it does not overlap Photo and is left alone."""
    start = datetime(2026, 7, 9, 11, 40, tzinfo=timezone.utc)
    pushed = _push_past_blocks(start, timedelta(minutes=20), BLOCKS)
    assert pushed == start


def test_compute_estimated_starts_pushes_match_out_of_photo_and_lunch():
    matches = [
        _match("m1", scheduled_at=datetime(2026, 7, 9, 11, 50, tzinfo=timezone.utc).isoformat()),
    ]
    est = _compute(matches)
    assert est["m1"] == LUNCH_END


def test_compute_estimated_starts_leaves_untouched_match_before_blocks():
    matches = [
        _match("m1", scheduled_at=datetime(2026, 7, 9, 11, 40, tzinfo=timezone.utc).isoformat()),
    ]
    est = _compute(matches)
    assert est["m1"] == datetime(2026, 7, 9, 11, 40, tzinfo=timezone.utc)


def test_court_resumes_together_after_a_block():
    """Two matches queued back-to-back on one court, both falling inside the
    blocks, resume sequentially right at the block's end — not stacked on
    top of each other."""
    matches = [
        _match("m1", scheduled_at=datetime(2026, 7, 9, 11, 50, tzinfo=timezone.utc).isoformat()),
        _match("m2", scheduled_at=datetime(2026, 7, 9, 12, 10, tzinfo=timezone.utc).isoformat()),
    ]
    est = _compute(matches)
    assert est["m1"] == LUNCH_END
    assert est["m2"] == LUNCH_END + timedelta(minutes=20)


def test_in_progress_match_is_not_force_pushed():
    """A match already started (actual_start set) is left to finish naturally
    even if it runs into a block — only not-yet-started matches are gated."""
    matches = [
        _match(
            "m1",
            actual_start=datetime(2026, 7, 9, 11, 55, tzinfo=timezone.utc).isoformat(),
        ),
    ]
    est = _compute(matches)
    assert est["m1"] == datetime(2026, 7, 9, 11, 55, tzinfo=timezone.utc)


def test_no_blocks_is_a_no_op():
    matches = [
        _match("m1", scheduled_at=datetime(2026, 7, 9, 11, 50, tzinfo=timezone.utc).isoformat()),
    ]
    est = _compute(matches, blocks=[])
    assert est["m1"] == datetime(2026, 7, 9, 11, 50, tzinfo=timezone.utc)


# ── pushed_by_block (GET /matches field) ────────────────────────────────────
# StatusBadge on the Schedule page shows an orange "~time" when
# estimated_start slips later than scheduled_at. Without this field, every
# match queued behind a lunch/photo block on the same court would show that
# treatment forever, even though none of the shift is "real" backup — it's
# all one lunch break. pushed_by_block distinguishes the two by comparing the
# real (with-blocks) estimate against a same-instant baseline computed with no
# blocks at all.

import app.routers.matches as matches_router
from fake_db import FakeSupabase


def _seed_sport(db, duration=20):
    return db.table("sports").insert({
        "name": "Test Sport",
        "bracket_type": "single_elimination",
        "match_duration_minutes": duration,
    }).execute().data[0]["id"]


def _seed_match(db, sport_id, scheduled_at, location_id="north"):
    return db.table("matches").insert({
        "sport_id": sport_id,
        "home_team_id": "t1",
        "away_team_id": "t2",
        "location_id": location_id,
        "status": "scheduled",
        "scheduled_at": scheduled_at.isoformat(),
    }).execute().data[0]


def _seed_block(db, start, end):
    db.table("schedule_blocks").insert({
        "label": "Lunch",
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
    }).execute()


def test_pushed_by_block_true_for_match_landing_on_block_end(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    sport_id = _seed_sport(db)
    _seed_block(db, LUNCH_START, LUNCH_END)
    m1 = _seed_match(db, sport_id, LUNCH_START + timedelta(minutes=10))  # overlaps lunch

    result = matches_router._attach_estimated_starts([m1])[0]

    assert result["estimated_start"] == LUNCH_END
    assert result["pushed_by_block"] is True


def test_pushed_by_block_true_for_second_match_queued_behind_the_first(monkeypatch):
    """The actual bug this field fixes: m2 is pushed by 20 extra minutes past
    the block's end (queued behind m1 on the same court) — it never lands
    exactly on a block boundary, but the shift is still 100% the same lunch
    break, not independent backup."""
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    sport_id = _seed_sport(db)
    _seed_block(db, LUNCH_START, LUNCH_END)
    m1 = _seed_match(db, sport_id, LUNCH_START + timedelta(minutes=10))
    m2 = _seed_match(db, sport_id, LUNCH_START + timedelta(minutes=30))

    result = {r["id"]: r for r in matches_router._attach_estimated_starts([m1, m2])}

    assert result[m1["id"]]["estimated_start"] == LUNCH_END
    assert result[m2["id"]]["estimated_start"] == LUNCH_END + timedelta(minutes=20)
    assert result[m1["id"]]["pushed_by_block"] is True
    assert result[m2["id"]]["pushed_by_block"] is True


def test_pushed_by_block_false_when_real_backup_exists_independent_of_block(monkeypatch):
    """m2 would already be running late even with no block at all (its court
    is held up by m1, which starts on time and takes its full duration) — a
    schedule block that happens to also apply elsewhere in the day should not
    mask that real delay."""
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    sport_id = _seed_sport(db, duration=20)
    far_away_start = datetime(2026, 7, 9, 15, 0, tzinfo=timezone.utc)
    far_away_end = datetime(2026, 7, 9, 15, 5, tzinfo=timezone.utc)
    _seed_block(db, far_away_start, far_away_end)  # irrelevant to this court's timing
    m1 = _seed_match(db, sport_id, datetime(2026, 7, 9, 11, 0, tzinfo=timezone.utc))
    m2 = _seed_match(db, sport_id, datetime(2026, 7, 9, 11, 10, tzinfo=timezone.utc))  # overlaps m1

    result = {r["id"]: r for r in matches_router._attach_estimated_starts([m1, m2])}

    m2_result = result[m2["id"]]
    assert m2_result["estimated_start"] == datetime(2026, 7, 9, 11, 20, tzinfo=timezone.utc)
    assert m2_result["pushed_by_block"] is False


def test_pushed_by_block_false_with_no_blocks_at_all(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(matches_router, "supabase", db)
    sport_id = _seed_sport(db)
    m1 = _seed_match(db, sport_id, datetime(2026, 7, 9, 11, 0, tzinfo=timezone.utc))

    result = matches_router._attach_estimated_starts([m1])[0]

    assert result["pushed_by_block"] is False
