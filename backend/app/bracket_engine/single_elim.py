"""Single-elimination bracket generator.

Produces a flat list of MatchSlots with winner_next_idx links set.
Bye slots (where one team is None due to non-power-of-2 field sizes) are
flagged is_bye=True and auto-completed during persistence.

Seeding follows the standard tournament bracket pattern:
  seed 1 vs seed N, seed 2 vs seed N-1, etc.
so the top seeds meet only in the later rounds.
"""

import math
from .types import MatchSlot


def _next_power_of_2(n: int) -> int:
    return 1 if n <= 1 else 2 ** math.ceil(math.log2(n))


def _seed_positions(size: int) -> list[int]:
    """Recursive standard bracket seeding for a field of `size` (must be power of 2).
    Returns positions such that seeded[pos[0]] vs seeded[pos[1]] is match 1, etc."""
    if size == 2:
        return [0, 1]
    half = size // 2
    top = _seed_positions(half)
    bottom = [size - 1 - i for i in top]
    result: list[int] = []
    for t, b in zip(top, bottom):
        result.extend([t, b])
    return result


def generate_single_elimination(teams: list[str | None]) -> list[MatchSlot]:
    """Generate all rounds of a single-elimination bracket.

    Args:
        teams: Team IDs ordered by seed (index 0 = top seed). None = bye slot.

    Returns:
        Flat list of MatchSlots in round order. Indices are used by winner_next_idx.
    """
    n = len(teams)
    if n < 2:
        raise ValueError("Single elimination requires at least 2 teams")

    size = _next_power_of_2(n)
    padded = list(teams) + [None] * (size - n)

    positions = _seed_positions(size)
    seeded = [padded[p] for p in positions]

    num_rounds = int(math.log2(size))
    all_matches: list[MatchSlot] = []
    round_start: dict[int, int] = {}

    for r in range(1, num_rounds + 1):
        round_start[r] = len(all_matches)
        match_count = size // (2 ** r)

        if r == 1:
            for i in range(0, size, 2):
                home, away = seeded[i], seeded[i + 1]
                all_matches.append(MatchSlot(
                    home_team_id=home,
                    away_team_id=away,
                    match_round=r,
                    bracket_phase="bracket",
                    is_bye=(home is None or away is None),
                ))
        else:
            for _ in range(match_count):
                all_matches.append(MatchSlot(
                    home_team_id=None,
                    away_team_id=None,
                    match_round=r,
                    bracket_phase="bracket",
                ))

    # Link each match to its winner's destination in the following round
    for r in range(1, num_rounds):
        count = size // (2 ** r)
        for i in range(count):
            src = round_start[r] + i
            dst = round_start[r + 1] + (i // 2)
            all_matches[src].winner_next_idx = dst

    return all_matches
