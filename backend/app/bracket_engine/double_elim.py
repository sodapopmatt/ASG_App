"""Double-elimination bracket generator.

Produces Winners Bracket (WB), Losers Bracket (LB), and Grand Final match slots
with both winner_next_idx and loser_next_idx links set.

Structure for N teams (N must be a power of 2):
  WB:  log2(N) rounds
  LB:  2*(log2(N)-1) rounds  (alternates merge + reduce)
  GF:  1 match

WB losers drop into LB on a predictable schedule:
  WB R1 losers  → LB R1  (paired, 2 WB losers per LB match)
  WB Rk losers  → LB R(2k-2)  for k = 2..W  (direct 1-to-1)
  WB Finals loser → LB Finals  (last LB round = R(2W-2))

LB internal progression:
  Odd→Even LB rounds  (merge): winner[i] → next[i]    (same count, WB losers fill other slot)
  Even→Odd LB rounds  (reduce): winner[i] → next[i//2] (half count)

Verified for N = 4, 8, 16.
"""

import math
from .types import MatchSlot
from .single_elim import _next_power_of_2, _seed_positions


def generate_double_elimination(teams: list[str | None]) -> list[MatchSlot]:
    """Generate all matches for a double-elimination bracket.

    Args:
        teams: Team IDs ordered by seed. None = bye.

    Returns:
        Flat list of MatchSlots: WB matches first, then LB, then Grand Final.
    """
    n = len(teams)
    if n < 2:
        raise ValueError("Double elimination requires at least 2 teams")

    size = _next_power_of_2(n)
    W = int(math.log2(size))  # number of WB rounds

    padded = list(teams) + [None] * (size - n)
    positions = _seed_positions(size)
    seeded = [padded[p] for p in positions]

    all_matches: list[MatchSlot] = []
    wb: dict[int, list[int]] = {}  # WB round → indices in all_matches
    lb: dict[int, list[int]] = {}  # LB round → indices in all_matches

    # ── Winners Bracket ──────────────────────────────────────────────────────
    for r in range(1, W + 1):
        wb[r] = []
        if r == 1:
            for i in range(0, size, 2):
                home, away = seeded[i], seeded[i + 1]
                idx = len(all_matches)
                all_matches.append(MatchSlot(
                    home_team_id=home,
                    away_team_id=away,
                    match_round=r,
                    bracket_phase="winners",
                    is_bye=(home is None or away is None),
                ))
                wb[r].append(idx)
        else:
            for _ in range(size // (2 ** r)):
                idx = len(all_matches)
                all_matches.append(MatchSlot(
                    home_team_id=None,
                    away_team_id=None,
                    match_round=r,
                    bracket_phase="winners",
                ))
                wb[r].append(idx)

    # ── Losers Bracket ───────────────────────────────────────────────────────
    # LB round count = 2*(W-1); sizes alternate: same then half.
    lb_round_count = 2 * (W - 1)
    curr = size // 4
    lb_counts: list[int] = []
    for lr in range(1, lb_round_count + 1):
        lb_counts.append(curr)
        if lr % 2 == 0:   # even round → next is a reduce round (half)
            curr //= 2
        # odd round → next is a merge round (same count)

    for lr, count in enumerate(lb_counts, start=1):
        lb[lr] = []
        for _ in range(count):
            idx = len(all_matches)
            all_matches.append(MatchSlot(
                home_team_id=None,
                away_team_id=None,
                match_round=lr,
                bracket_phase="losers",
            ))
            lb[lr].append(idx)

    # ── Grand Final ──────────────────────────────────────────────────────────
    gf_idx = len(all_matches)
    all_matches.append(MatchSlot(
        home_team_id=None,
        away_team_id=None,
        match_round=1,
        bracket_phase="finals",
    ))

    # ── Link Winners Bracket ─────────────────────────────────────────────────
    for r in range(1, W):
        for i, m_idx in enumerate(wb[r]):
            all_matches[m_idx].winner_next_idx = wb[r + 1][i // 2]

    for m_idx in wb[W]:                              # WB Finals winner → GF
        all_matches[m_idx].winner_next_idx = gf_idx

    # WB R1 losers → LB R1 (two WB losers per LB match)
    if W == 1:
        # 2-team bracket: no losers bracket exists — the sole WB match doubles
        # as WB finals, so its loser drops straight into the grand final.
        all_matches[wb[1][0]].loser_next_idx = gf_idx
    else:
        for i, m_idx in enumerate(wb[1]):
            all_matches[m_idx].loser_next_idx = lb[1][i // 2]

    # WB Rk (k=2..W) losers → LB R(2k-2)
    for k in range(2, W + 1):
        lb_target_round = 2 * (k - 1)              # WB R2→LB R2, R3→LB R4, …Finals→LB Finals
        for i, m_idx in enumerate(wb[k]):
            all_matches[m_idx].loser_next_idx = lb[lb_target_round][i]

    # ── Link Losers Bracket ──────────────────────────────────────────────────
    lb_rounds = sorted(lb.keys())
    for ri, lr in enumerate(lb_rounds[:-1]):
        next_lr = lb_rounds[ri + 1]
        curr_count = len(lb[lr])
        next_count = len(lb[next_lr])
        for i, m_idx in enumerate(lb[lr]):
            if next_count == curr_count:
                all_matches[m_idx].winner_next_idx = lb[next_lr][i]        # merge
            else:
                all_matches[m_idx].winner_next_idx = lb[next_lr][i // 2]  # reduce

    if lb_rounds:
        for m_idx in lb[lb_rounds[-1]]:              # LB Finals winner → GF
            all_matches[m_idx].winner_next_idx = gf_idx

    return all_matches
