"""Structural invariants for the pure bracket generators (no DB involved)."""

import math

import pytest

from app.bracket_engine.single_elim import generate_single_elimination, _next_power_of_2
from app.bracket_engine.double_elim import generate_double_elimination
from app.bracket_engine.generator import _resolve_same_company_conflicts
from app.bracket_engine.single_elim import _seed_positions


def _team_ids(n):
    return [f"team-{i}" for i in range(n)]


@pytest.mark.parametrize("n", range(2, 21))
def test_single_elim_structure(n):
    slots = generate_single_elimination(_team_ids(n))
    size = _next_power_of_2(n)

    assert len(slots) == size - 1

    # Every real team appears exactly once, all in round 1
    r1_teams = [t for s in slots if s.match_round == 1
                for t in (s.home_team_id, s.away_team_id) if t]
    assert sorted(r1_teams) == sorted(_team_ids(n))
    assert all(s.home_team_id is None and s.away_team_id is None
               for s in slots if s.match_round > 1)

    # Byes only in round 1
    assert all(s.match_round == 1 for s in slots if s.is_bye)

    # Exactly one root; all links point forward; every non-root links out
    roots = [i for i, s in enumerate(slots) if s.winner_next_idx is None]
    assert len(roots) == 1
    for i, s in enumerate(slots):
        if s.winner_next_idx is not None:
            assert s.winner_next_idx > i
            assert slots[s.winner_next_idx].match_round == s.match_round + 1

    # Every round-2+ match receives exactly 2 feeders
    inbound: dict[int, int] = {}
    for s in slots:
        if s.winner_next_idx is not None:
            inbound[s.winner_next_idx] = inbound.get(s.winner_next_idx, 0) + 1
    for i, s in enumerate(slots):
        if s.match_round > 1:
            assert inbound.get(i) == 2


@pytest.mark.parametrize("n", range(2, 21))
def test_double_elim_structure(n):
    slots = generate_double_elimination(_team_ids(n))
    size = _next_power_of_2(n)
    W = int(math.log2(size))

    wb = [s for s in slots if s.bracket_phase == "winners"]
    lb = [s for s in slots if s.bracket_phase == "losers"]
    gf = [s for s in slots if s.bracket_phase == "finals"]

    assert len(wb) == size - 1
    assert len(gf) == 1
    if W > 1:
        # LB total = size - 2 (every team except WB winner and one other is
        # eliminated in LB; standard double-elim count)
        assert len(lb) == size - 2

    # All links point strictly forward in the flat list (safe topological order)
    for i, s in enumerate(slots):
        for nxt in (s.winner_next_idx, s.loser_next_idx):
            if nxt is not None:
                assert nxt > i

    # Grand final is the sole root
    roots = [i for i, s in enumerate(slots) if s.winner_next_idx is None]
    gf_idx = slots.index(gf[0])
    assert roots == [gf_idx]

    # Every WB match drops its loser somewhere (LB or, for 2 teams, the GF)
    for s in wb:
        assert s.loser_next_idx is not None

    # Every LB slot receives exactly 2 inbound links (winner- or loser-side),
    # and the grand final receives exactly 2 (WB champion + LB champion)
    inbound: dict[int, int] = {}
    for s in slots:
        for nxt in (s.winner_next_idx, s.loser_next_idx):
            if nxt is not None:
                inbound[nxt] = inbound.get(nxt, 0) + 1
    for i, s in enumerate(slots):
        if s.bracket_phase == "losers":
            assert inbound.get(i) == 2, f"LB slot {i} (round {s.match_round}) has {inbound.get(i)} feeders"
        if s.bracket_phase == "finals":
            assert inbound.get(i) == 2
        if s.bracket_phase == "winners" and s.match_round > 1:
            assert inbound.get(i) == 2


@pytest.mark.parametrize("n_companies,teams_per", [(4, 2), (5, 2), (8, 2), (3, 3), (6, 2)])
def test_same_company_never_meets_in_r1_when_avoidable(n_companies, teams_per):
    team_ids = []
    company_map = {}
    for c in range(n_companies):
        for t in range(teams_per):
            tid = f"c{c}-t{t}"
            team_ids.append(tid)
            company_map[tid] = f"company-{c}"

    resolved = _resolve_same_company_conflicts(team_ids, company_map)
    assert sorted(resolved) == sorted(team_ids)  # a permutation, nothing lost

    n = len(resolved)
    size = _next_power_of_2(n)
    positions = _seed_positions(size)
    for k in range(size // 2):
        a_idx, b_idx = positions[2 * k], positions[2 * k + 1]
        if a_idx >= n or b_idx >= n:
            continue
        a, b = resolved[a_idx], resolved[b_idx]
        assert company_map[a] != company_map[b], f"R1 pair {a} vs {b} share a company"


def test_same_company_unavoidable_terminates():
    # One company holds 3 of 4 slots — a conflict is inevitable; the function
    # must terminate and return a permutation rather than loop forever.
    team_ids = ["a1", "a2", "a3", "b1"]
    company_map = {"a1": "A", "a2": "A", "a3": "A", "b1": "B"}
    resolved = _resolve_same_company_conflicts(team_ids, company_map)
    assert sorted(resolved) == sorted(team_ids)
