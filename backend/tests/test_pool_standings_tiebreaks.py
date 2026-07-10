"""Unit tests for the pool_bracket standings tiebreak chain (wins -> head-to-head
-> point differential -> total points), per the official Pickleball rulebook.

These exercise `_build_records`/`_rank_standings` directly with hand-built match
dicts rather than going through the API, since MatchDraw doesn't carry
points_total fields and /result always requires a winner — there's no realistic
API path to a "tied on wins, no decisive head-to-head" match state without a
truncated round robin, which is fragile to hand-construct. Testing the pure
ranking function directly is the precise way to pin down this behavior.
"""

from app.routers.sports import _build_records, _rank_standings


def match(home, away, winner=None, status="completed", home_points_total=None, away_points_total=None):
    return {
        "home_team_id": home,
        "away_team_id": away,
        "winner_id": winner,
        "status": status,
        "home_score": None,
        "away_score": None,
        "home_games_won": None,
        "away_games_won": None,
        "home_points_total": home_points_total,
        "away_points_total": away_points_total,
    }


def test_head_to_head_breaks_a_straight_two_team_win_tie():
    """a and b both finish 2-1; a beat b directly, so a must outrank b even
    though nothing else (point_diff/total_points) is set."""
    matches = [
        match("a", "b", winner="a"),
        match("a", "c", winner="c"),
        match("a", "d", winner="a"),
        match("b", "c", winner="b"),
        match("b", "d", winner="b"),
        match("c", "d", winner="d"),
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["a"]["wins"] == table["b"]["wins"] == 2
    assert table["a"]["rank"] < table["b"]["rank"]


def test_point_diff_breaks_tie_when_head_to_head_unavailable():
    """c and d tie on wins (0 each) and never played each other directly (the
    pair is absent from this pool's matches, e.g. a truncated round robin) —
    head-to-head can't apply, so point differential should decide it."""
    matches = [
        match("a", "b", winner="a"),
        match("a", "c", winner="a", home_points_total=21, away_points_total=15),
        match("a", "d", winner="a", home_points_total=21, away_points_total=10),
        match("b", "c", winner="b", home_points_total=21, away_points_total=18),
        match("b", "d", winner="b", home_points_total=21, away_points_total=12),
        # c and d never play each other in this pool.
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["c"]["wins"] == table["d"]["wins"] == 0
    assert table["c"]["point_diff"] > table["d"]["point_diff"]
    assert table["c"]["rank"] < table["d"]["rank"]


def test_point_diff_also_breaks_tie_after_an_undecided_head_to_head():
    """c and d tie on wins and did play each other, but it was a draw — no
    decisive winner to hand the tiebreak to — so it still falls through to
    point differential."""
    matches = [
        match("a", "b", winner="a"),
        match("a", "c", winner="a", home_points_total=21, away_points_total=15),
        match("a", "d", winner="a", home_points_total=21, away_points_total=10),
        match("b", "c", winner="b", home_points_total=21, away_points_total=18),
        match("b", "d", winner="b", home_points_total=21, away_points_total=12),
        match("c", "d", winner=None, status="draw", home_points_total=22, away_points_total=20),
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["c"]["wins"] == table["d"]["wins"] == 0
    assert table["c"]["point_diff"] > table["d"]["point_diff"]
    assert table["c"]["rank"] < table["d"]["rank"]


def test_total_points_breaks_tie_when_point_diff_also_equal():
    """a and b never play each other, each go 1-1 against different opponents,
    and each nets a point_diff of exactly 0 — but a racked up much bigger
    per-game point totals along the way, so total points scored separates them."""
    matches = [
        match("a", "x", winner="a", home_points_total=21, away_points_total=15),
        match("a", "y", winner="y", home_points_total=15, away_points_total=21),
        match("b", "x", winner="b", home_points_total=11, away_points_total=5),
        match("b", "y", winner="y", home_points_total=5, away_points_total=11),
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["a"]["wins"] == table["b"]["wins"] == 1
    assert table["a"]["point_diff"] == table["b"]["point_diff"] == 0
    assert table["a"]["total_points"] == 36 and table["b"]["total_points"] == 16
    assert table["a"]["rank"] < table["b"]["rank"]


def test_shares_rank_when_every_criterion_is_genuinely_tied():
    """If wins, point_diff, and total_points are all identical, the tie is
    real and the two teams should still share a rank."""
    matches = [
        match("a", "x", winner="a", home_points_total=21, away_points_total=15),
        match("b", "y", winner="b", home_points_total=21, away_points_total=15),
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["a"]["wins"] == table["b"]["wins"] == 1
    assert table["a"]["point_diff"] == table["b"]["point_diff"] == 6
    assert table["a"]["total_points"] == table["b"]["total_points"] == 21
    assert table["a"]["rank"] == table["b"]["rank"]


def test_three_way_win_tie_skips_head_to_head_uses_point_diff():
    """A 3+-way tie on wins can't be resolved by a single head-to-head match,
    so it should go straight to point differential."""
    matches = [
        match("a", "b", winner="a"),
        match("b", "c", winner="b"),
        match("c", "a", winner="c", home_points_total=25, away_points_total=5),
    ]
    records = _build_records(matches)
    standings = _rank_standings(records, matches=matches)
    table = {row["team_id"]: row for row in standings}

    assert table["a"]["wins"] == table["b"]["wins"] == table["c"]["wins"] == 1
    # c has the biggest point differential (won 25-5), so it should rank first
    # despite the rock-paper-scissors win cycle.
    assert table["c"]["rank"] == 1
