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


@pytest.mark.parametrize("n", range(2, 21))
def test_single_elim_byes_go_to_top_seeds(n):
    """Byes are not arbitrary: they must land on the highest-seeded teams
    (input order = seed order, index 0 = top seed), and the real round-1
    match(es) must be contested by the lowest-seeded remainder — the same
    result a human seeding a bracket by hand would produce."""
    teams = _team_ids(n)
    slots = generate_single_elimination(teams)
    size = _next_power_of_2(n)
    n_byes = size - n
    top_seeds = set(teams[:n_byes])
    bottom_seeds = set(teams[n_byes:])

    r1 = [s for s in slots if s.match_round == 1]
    bye_recipients = {
        (s.home_team_id or s.away_team_id) for s in r1 if s.is_bye
    }
    real_match_teams = {
        t for s in r1 if not s.is_bye for t in (s.home_team_id, s.away_team_id)
    }

    assert bye_recipients == top_seeds
    assert real_match_teams == bottom_seeds


@pytest.mark.parametrize("n", [2, 4, 8, 16])
def test_single_elim_full_bracket_seed_pairing(n):
    """With no byes needed (n is already a power of 2), round 1 must follow
    the textbook 1-vs-N, 2-vs-(N-1) pairing — not merely non-overlapping."""
    teams = _team_ids(n)
    slots = generate_single_elimination(teams)
    r1 = [s for s in slots if s.match_round == 1]
    pairs = {frozenset((s.home_team_id, s.away_team_id)) for s in r1}

    expected = {frozenset((teams[i], teams[n - 1 - i])) for i in range(n // 2)}
    assert pairs == expected


@pytest.mark.parametrize("n", range(2, 21))
def test_double_elim_wb_byes_go_to_top_seeds(n):
    """Same top-seeds-get-byes guarantee, applied to the winners bracket of a
    double-elimination draw (it reuses the same seeding formula)."""
    teams = _team_ids(n)
    slots = generate_double_elimination(teams)
    size = _next_power_of_2(n)
    n_byes = size - n
    if n_byes == 0:
        return
    top_seeds = set(teams[:n_byes])

    wb_r1 = [s for s in slots if s.bracket_phase == "winners" and s.match_round == 1]
    bye_recipients = {
        (s.home_team_id or s.away_team_id) for s in wb_r1 if s.is_bye
    }
    assert bye_recipients == top_seeds


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
