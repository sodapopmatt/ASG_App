"""Hand-built regression cases for _compute_estimated_starts, pinning the two
bugs found during event testing:

1. Court collision — WB R2 and LB R1 share feeders, so Pass 2 gave both the
   same estimated_start on the same court.
2. Bye inflation — a match auto-completed by a bye slot was charged a full
   duration slot, delaying everything downstream and blocking its court.
"""

from datetime import datetime, timedelta, timezone

from app.routers.matches import _compute_estimated_starts

START = datetime(2026, 7, 4, 9, 0, tzinfo=timezone.utc)
DUR = 20
SPORT = "sport-1"


def _match(mid, **kw):
    row = {
        "id": mid,
        "sport_id": SPORT,
        "bracket_id": None,
        "home_team_id": None,
        "away_team_id": None,
        "location_id": None,
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


def _compute(matches):
    return _compute_estimated_starts(matches, {SPORT: DUR}, {SPORT: START})


def test_shared_feeders_do_not_collide_on_one_court():
    """4-team double-elim shape on one court: WB R2 and LB R1 are both fed by
    the two WB R1 matches. They must not get the same court+time."""
    matches = [
        _match("wb1a", home_team_id="t1", away_team_id="t4", location_id="north",
               scheduled_at=START.isoformat(),
               winner_next_match_id="wb2", loser_next_match_id="lb1"),
        _match("wb1b", home_team_id="t2", away_team_id="t3", location_id="north",
               scheduled_at=(START + timedelta(minutes=DUR)).isoformat(),
               winner_next_match_id="wb2", loser_next_match_id="lb1"),
        _match("wb2", match_round=2, location_id="north", winner_next_match_id="gf"),
        _match("lb1", location_id="north", winner_next_match_id="gf"),
        _match("gf", location_id=None),
    ]
    est = _compute(matches)

    both_feeders_done = START + timedelta(minutes=2 * DUR)
    assert est["wb2"] is not None and est["lb1"] is not None
    assert min(est["wb2"], est["lb1"]) == both_feeders_done
    # The other match must wait a full slot — same court
    assert abs(est["wb2"] - est["lb1"]) >= timedelta(minutes=DUR)
    # And the grand final must start after both are done
    for mid in ("wb2", "lb1"):
        assert est["gf"] >= est[mid] + timedelta(minutes=DUR)


def test_bye_feeder_adds_no_duration():
    """A feeder auto-resolved by a bye finishes instantly: its downstream match
    starts when the real feeder finishes, not one slot later."""
    matches = [
        _match("real", home_team_id="t1", away_team_id="t2", location_id="north",
               scheduled_at=START.isoformat(), winner_next_match_id="semi"),
        # LB-style match holding one real team against a permanent bye
        _match("bye-match", home_team_id="t3", away_slot_state="bye",
               location_id="north",
               scheduled_at=(START + timedelta(minutes=DUR)).isoformat(),
               winner_next_match_id="semi"),
        _match("semi", match_round=2, location_id="north"),
    ]
    est = _compute(matches)

    # real finishes at START+DUR; bye-match occupies zero time, so the semi
    # starts right when the real match ends — not a slot later
    assert est["semi"] == START + timedelta(minutes=DUR)
    # and the bye match itself shows no time — it will never be played
    assert est["bye-match"] is None


def test_bye_match_does_not_block_its_court():
    """A bye-autocomplete match sitting on a court must not push the next real
    match on that court back by a full slot, and must not display a time."""
    matches = [
        _match("bye-match", home_team_id="t1", away_slot_state="bye",
               location_id="north", scheduled_at=START.isoformat()),
        _match("real", home_team_id="t2", away_team_id="t3", location_id="north",
               scheduled_at=START.isoformat()),
    ]
    est = _compute(matches)

    assert est["real"] == START  # bye takes zero court time
    assert est["bye-match"] is None  # no phantom game time in the UI


def test_completed_match_keeps_slot_and_next_follows():
    """A completed match retains its scheduled slot for display, and the next
    match on the court is estimated after it — never on top of it."""
    matches = [
        _match("done", home_team_id="t1", away_team_id="t2", location_id="north",
               scheduled_at=START.isoformat(), status="completed", winner_id="t1"),
        _match("next", home_team_id="t3", away_team_id="t4", location_id="north",
               scheduled_at=START.isoformat()),
    ]
    est = _compute(matches)

    assert est["done"] == START
    assert est["next"] == START + timedelta(minutes=DUR)


def test_completed_bye_has_no_estimate():
    """An auto-completed bye with no scheduled_at carries no estimate at all."""
    matches = [
        _match("bye", home_team_id="t1", away_slot_state="bye",
               status="completed", winner_id="t1"),
    ]
    est = _compute(matches)

    assert est["bye"] is None
