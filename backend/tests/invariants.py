"""Shared schedule/bracket invariant assertions used across test modules."""

from datetime import timedelta


def is_bye_autocomplete(m: dict) -> bool:
    return m.get("home_slot_state") == "bye" or m.get("away_slot_state") == "bye"


def duration_of(m: dict, minutes: int) -> timedelta:
    return timedelta(minutes=0 if is_bye_autocomplete(m) else minutes)


def assert_no_court_overlap(matches, est, minutes):
    """No two matches on the same court may have overlapping time windows.
    Bye-autocomplete matches occupy zero time and never conflict."""
    by_court: dict = {}
    for m in matches:
        loc = m.get("location_id")
        t = est.get(m["id"])
        if loc is None or t is None:
            continue
        by_court.setdefault(loc, []).append((t, t + duration_of(m, minutes), m["id"]))

    for loc, iv in by_court.items():
        for i in range(len(iv)):
            for j in range(i + 1, len(iv)):
                a, b = iv[i], iv[j]
                assert not (a[0] < b[1] and b[0] < a[1]), (
                    f"court {loc}: match {a[2]} [{a[0]} - {a[1]}] "
                    f"overlaps match {b[2]} [{b[0]} - {b[1]}]"
                )


def assert_feeder_ordering(matches, est, minutes):
    """Every match must start at or after the finish of each feeder that has an
    estimate. Bye-autocomplete feeders finish instantly (zero duration)."""
    by_id = {m["id"]: m for m in matches}
    for m in matches:
        for key in ("winner_next_match_id", "loser_next_match_id"):
            nid = m.get(key)
            if not nid or nid not in by_id:
                continue
            t_feeder, t_down = est.get(m["id"]), est.get(nid)
            if t_feeder is None or t_down is None:
                continue
            finish = t_feeder + duration_of(m, minutes)
            assert t_down >= finish, (
                f"match {nid} (round {by_id[nid].get('match_round')}) starts {t_down} "
                f"before feeder {m['id']} (round {m.get('match_round')}) finishes {finish}"
            )


def assert_all_scheduled_have_estimates(matches, est):
    """Every match still awaiting play must show a time to the public.
    Matches whose slots are both byes resolve automatically and are exempt."""
    for m in matches:
        if m["status"] != "scheduled":
            continue
        both_bye = m.get("home_slot_state") == "bye" and m.get("away_slot_state") == "bye"
        if both_bye:
            continue
        assert est.get(m["id"]) is not None, (
            f"scheduled match {m['id']} (round {m.get('match_round')}, "
            f"home={m.get('home_team_id')}, away={m.get('away_team_id')}, "
            f"slots={m.get('home_slot_state')}/{m.get('away_slot_state')}) has no estimated_start"
        )
