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
