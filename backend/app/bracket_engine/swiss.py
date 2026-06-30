"""Swiss-system pairing for Cornhole championship rounds."""
from __future__ import annotations


def generate_swiss_pairings(
    team_ids: list[str],
    previous_matchups: set[frozenset],
) -> list[tuple[str, str]]:
    """Pair teams for one Swiss round.

    team_ids must be sorted by current standing (best first).
    Pairs greedily: each team plays the highest-ranked available opponent
    they have not yet faced. Falls back to a repeat matchup only when no
    rematch-free option remains.

    Returns (home, away) tuples. Odd number of teams: last team gets a bye
    and is omitted from the returned pairs.
    """
    remaining = list(team_ids)
    pairs: list[tuple[str, str]] = []

    while len(remaining) >= 2:
        home = remaining[0]
        paired = False
        for j in range(1, len(remaining)):
            away = remaining[j]
            if frozenset([home, away]) not in previous_matchups:
                pairs.append((home, away))
                remaining.pop(j)
                remaining.pop(0)
                paired = True
                break
        if not paired:
            # All remaining opponents already faced — pair with next in line
            away = remaining[1]
            pairs.append((home, away))
            remaining.pop(1)
            remaining.pop(0)

    return pairs
