"""Round-robin pool generator (circle method).

Produces one match per team pairing, grouped into rounds where every team
plays at most once. With an odd team count, one team sits out each round —
no bye match rows are created.

Because the circle method emits one round at a time and every team plays
exactly once per round, a truncated round robin — "each team plays ~K
opponents" — is just the first K rounds. Pass `max_rounds` to cap it; every
team then plays exactly K distinct opponents (odd counts sit one team out per
round, so those teams may play slightly fewer), balanced and non-repeating.

Pool matches have no winner_next_idx / loser_next_idx links: standings are
computed from results, and advancement to a bracket phase is a separate,
admin-triggered generation step.
"""

from .types import MatchSlot


def generate_round_robin(teams: list[str], max_rounds: int | None = None) -> list[MatchSlot]:
    """Generate a single round-robin for one pool.

    Args:
        teams: Team IDs in the pool (order does not affect who plays whom).
        max_rounds: If set, cap the schedule at this many rounds (= games per
            team). None (or a value ≥ the full round count) produces a complete
            round robin where every pair meets once.

    Returns:
        Flat list of MatchSlots ordered by round. match_round starts at 1.
        Without max_rounds, every pair of teams meets exactly once.
    """
    n = len(teams)
    if n < 2:
        raise ValueError("Round robin requires at least 2 teams")
    if max_rounds is not None and max_rounds < 1:
        raise ValueError("max_rounds must be at least 1")

    # Circle method: fix the first slot, rotate the rest each round.
    # Pad with None for odd counts; a pairing involving None is a sit-out.
    circle: list[str | None] = list(teams)
    if n % 2 == 1:
        circle.append(None)

    size = len(circle)
    rounds = size - 1
    if max_rounds is not None:
        rounds = min(rounds, max_rounds)
    half = size // 2

    all_matches: list[MatchSlot] = []
    for r in range(1, rounds + 1):
        for i in range(half):
            home, away = circle[i], circle[size - 1 - i]
            if home is None or away is None:
                continue
            all_matches.append(MatchSlot(
                home_team_id=home,
                away_team_id=away,
                match_round=r,
                bracket_phase="pool",
            ))
        # Rotate clockwise: everything but the fixed first element shifts
        circle = [circle[0], circle[-1]] + circle[1:-1]

    return all_matches
