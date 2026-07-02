"""Bracket persistence layer.

Calls a pure generator, inserts brackets + matches into Supabase,
then wires up winner_next_match_id / loser_next_match_id links
and auto-completes any bye slots.
"""

import math
from datetime import datetime, timedelta

from supabase import Client
from .types import MatchSlot
from . import single_elim, double_elim, round_robin
from .single_elim import _next_power_of_2, _seed_positions

_GENERATORS = {
    "single_elimination": single_elim.generate_single_elimination,
    "double_elimination": double_elim.generate_double_elimination,
}

_PHASE_NAMES = {
    "bracket": "Main Bracket",
    "winners": "Winners Bracket",
    "losers": "Losers Bracket",
    "finals": "Grand Final",
}


def _fetch_company_map(team_ids: list[str], db: Client) -> dict[str, str]:
    """Returns {team_id: company_id} for the given team IDs."""
    rows = db.table("teams").select("id, company_id").in_("id", team_ids).execute()
    return {r["id"]: r["company_id"] for r in rows.data}


def _count_r1_conflicts(
    teams: list[str],
    company_map: dict[str, str],
    positions: list[int],
    n: int,
) -> int:
    """Number of round-1 pairs where both slots hold teams from the same company."""
    conflicts = 0
    for k in range(len(positions) // 2):
        a_idx, b_idx = positions[2 * k], positions[2 * k + 1]
        if a_idx >= n or b_idx >= n:
            continue
        if company_map.get(teams[a_idx]) == company_map.get(teams[b_idx]):
            conflicts += 1
    return conflicts


def _resolve_same_company_conflicts(
    team_ids: list[str],
    company_map: dict[str, str],
) -> list[str]:
    """Apply standard seed positions to team_ids, then resolve same-company
    first-round pairs with minimal swaps. Deterministic: the same team_ids
    order always produces the same bracket.

    A swap is only accepted when it strictly reduces the total conflict count —
    a swap that fixes one pair while breaking another is rejected. This
    guarantees termination even when conflicts are unavoidable (one company
    holding more than half the slots), in which case the remaining conflicts
    are left silently. After each accepted swap the scan restarts from the
    beginning.
    """
    teams = list(team_ids)

    n = len(teams)
    size = _next_power_of_2(n)
    positions = _seed_positions(size)
    num_pairs = size // 2

    changed = True
    while changed:
        changed = False
        conflicts = _count_r1_conflicts(teams, company_map, positions, n)
        if conflicts == 0:
            break

        for k in range(num_pairs):
            a_idx = positions[2 * k]
            b_idx = positions[2 * k + 1]

            if a_idx >= n or b_idx >= n:
                continue

            if company_map.get(teams[a_idx]) != company_map.get(teams[b_idx]):
                continue

            # Try swapping b with slots from other pairs; keep the first swap
            # that strictly reduces total conflicts, otherwise revert it.
            for j in range(num_pairs):
                if j == k:
                    continue
                for cand_idx in (positions[2 * j], positions[2 * j + 1]):
                    if cand_idx >= n:
                        continue
                    teams[b_idx], teams[cand_idx] = teams[cand_idx], teams[b_idx]
                    if _count_r1_conflicts(teams, company_map, positions, n) < conflicts:
                        changed = True
                        break
                    teams[b_idx], teams[cand_idx] = teams[cand_idx], teams[b_idx]
                if changed:
                    break
            if changed:
                break

    return teams


def _assign_courts_subtree(slots: list[MatchSlot], courts: list[str]) -> dict[int, str | None]:
    """Map slot index → court UUID (or None for the grand final).

    Winners bracket: subtree grouping — the group of R1 matches that ultimately
    feed the same R2 match all share a court, so a court's chain plays
    continuously without gaps between rounds.

    Losers bracket: simple round-robin across all courts.

    Grand final (bracket_phase == 'finals'): None — court is assigned
    dynamically at runtime when the first semifinal ends.
    """
    if not courts:
        return {}

    C = len(courts)
    assignment: dict[int, str | None] = {}

    # Grand final gets no pre-assigned court
    for i, s in enumerate(slots):
        if s.bracket_phase == "finals":
            assignment[i] = None

    # Winners bracket: group R1 into C blocks then propagate up.
    # Byes are included here (unlike the rest of the WB set) so that a court
    # still gets forwarded to a R2+ match even when both of its R1 feeders
    # were byes — otherwise that match would end up with no court at all.
    wb_phases = {"winners", "bracket"}
    wb_all = [i for i, s in enumerate(slots) if s.bracket_phase in wb_phases]

    if wb_all:
        min_round = min(slots[i].match_round for i in wb_all)
        r1 = [i for i in wb_all if slots[i].match_round == min_round]

        # Adjacent R1 pairs feed the same R2 match, so assign in contiguous
        # blocks — balanced by real (non-bye) match count so no court ends up
        # with a longer round-1 queue than necessary: the first (real % C)
        # courts take one extra real match. Byes ride along on the current
        # court without counting toward its load; they occupy no play time and
        # only exist so a court can propagate up to their R2 match.
        real_total = sum(1 for i in r1 if not slots[i].is_bye)
        base, extra = divmod(real_total, C)
        court_idx = 0
        filled = 0
        for i in r1:
            if not slots[i].is_bye:
                capacity = base + (1 if court_idx < extra else 0)
                while filled >= capacity and court_idx < C - 1:
                    court_idx += 1
                    filled = 0
                    capacity = base + (1 if court_idx < extra else 0)
                filled += 1
            assignment[i] = courts[court_idx]

        # Propagate court up through winner_next_idx (slots are ordered by round,
        # so iterating by index is already topological order within the WB)
        for i, s in enumerate(slots):
            if s.bracket_phase not in wb_phases:
                continue
            if i not in assignment:
                continue
            nxt = s.winner_next_idx
            if nxt is None or slots[nxt].bracket_phase == "finals":
                continue
            if nxt not in assignment:
                assignment[nxt] = assignment[i]

    # Losers bracket: round-robin
    lb = [i for i, s in enumerate(slots) if s.bracket_phase == "losers" and not s.is_bye]
    for pos, i in enumerate(lb):
        assignment[i] = courts[pos % C]

    return assignment


def _compute_scheduled_times(
    slots: list[MatchSlot],
    assignment: dict[int, str | None],
    start_time: datetime,
    match_duration_minutes: int,
) -> dict[int, str]:
    """Return {slot_index: ISO scheduled_at} for non-bye slots with both teams.

    Only schedules matches where both home_team_id and away_team_id are set,
    allowing dependent matches (losers bracket, later rounds) to receive teams
    and be scheduled when they become playable.

    Within each court, matches are scheduled sequentially (chain order).
    The grand final (court=None) is scheduled after the deepest court finishes.
    """
    duration = timedelta(minutes=match_duration_minutes)

    # Group non-bye slots with both teams by court
    # Without court assignments we can't produce meaningful times
    if not assignment:
        return {}

    court_chains: dict[str, list[int]] = {}
    final_indices: list[int] = []

    for i, s in enumerate(slots):
        if s.is_bye:
            continue
        if s.home_team_id is None or s.away_team_id is None:
            continue
        court = assignment.get(i)
        if court is None:
            final_indices.append(i)
        else:
            court_chains.setdefault(court, []).append(i)

    scheduled: dict[int, str] = {}

    # Sequential scheduling within each court (sort by round, then index)
    court_depths: list[int] = []
    for court, indices in court_chains.items():
        indices.sort(key=lambda i: (slots[i].match_round, i))
        t = start_time
        for i in indices:
            scheduled[i] = t.isoformat()
            t += duration
        court_depths.append(len(indices))

    # Grand final starts when the last court finishes its last match
    if final_indices:
        max_depth = max(court_depths, default=0)
        final_time = start_time + timedelta(minutes=max_depth * match_duration_minutes)
        for i in final_indices:
            scheduled[i] = final_time.isoformat()

    return scheduled


def _delete_brackets_by_id(bracket_ids: list[str], db: Client) -> None:
    """Delete the given brackets and their matches, safely handling FK self-references."""
    for bid in bracket_ids:
        db.table("matches").update({
            "winner_next_match_id": None,
            "loser_next_match_id": None,
        }).eq("bracket_id", bid).execute()
        db.table("matches").delete().eq("bracket_id", bid).execute()
        db.table("brackets").delete().eq("id", bid).execute()


def clear_brackets(sport_id: str, db: Client) -> None:
    """Delete all brackets and matches for a sport, safely handling FK self-references."""
    existing = db.table("brackets").select("id").eq("sport_id", sport_id).execute()
    _delete_brackets_by_id([b["id"] for b in existing.data], db)

    # Delete unbucketed matches (e.g. heats, where bracket_id is null)
    db.table("matches").delete().eq("sport_id", sport_id).is_("bracket_id", "null").execute()


def clear_bracket_phase(sport_id: str, db: Client) -> None:
    """Delete only the elimination bracket-phase brackets/matches for a pool_bracket
    sport (phase != 'pool'), leaving pool play untouched. Used to restart the
    seeded bracket phase without wiping pool results."""
    existing = db.table("brackets").select("id").eq("sport_id", sport_id).neq("phase", "pool").execute()
    _delete_brackets_by_id([b["id"] for b in existing.data], db)


def persist_bracket(
    sport_id: str,
    team_ids: list[str],
    db: Client,
    clear_existing: bool = False,
    location_ids: list[str] | None = None,
    start_time: datetime | None = None,
    match_duration_minutes: int = 30,
    division: str | None = None,
    bracket_type_override: str | None = None,
    shuffle: bool = True,
) -> dict:
    """Generate and save a bracket for a sport.

    Args:
        sport_id:              UUID of the sport.
        team_ids:              Team UUIDs ordered by seed (index 0 = top seed).
        db:                    Supabase client (service role).
        clear_existing:        If True, delete existing brackets/matches first.
        location_ids:          Court UUIDs to assign. Subtree grouping for WB,
                               round-robin for LB, dynamic (None) for grand final.
        start_time:            Earliest start time for the first match on each court.
        match_duration_minutes: Minutes per match slot on each court.
        division:              Division label (e.g. "Main Gym") when the sport is
                               split across venues; prefixes bracket names and is
                               stored on each bracket row.
        bracket_type_override: Generate this bracket type regardless of the sport's
                               own bracket_type — used for the bracket phase of
                               pool_bracket sports (single elimination after pools).
        shuffle:               If False, keep team_ids exactly as given (no
                               same-company conflict resolution). Used when
                               seeding comes from pool standings and must be
                               preserved exactly.

    Returns:
        Summary dict with bracket_ids, match_count, final_match_id (the root
        match no winner advances out of), and max_round.

    Raises:
        ValueError: If the sport's bracket_type has no generator yet.
    """
    sport_row = db.table("sports").select("bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport_row.data:
        raise ValueError("Sport not found")

    bracket_type: str = bracket_type_override or sport_row.data[0]["bracket_type"]
    generator = _GENERATORS.get(bracket_type)
    if generator is None:
        raise ValueError(
            f"Bracket generation is not yet supported for '{bracket_type}'. "
            "Enter results and placements manually for this sport."
        )

    if shuffle:
        company_map = _fetch_company_map(team_ids, db)
        team_ids = _resolve_same_company_conflicts(team_ids, company_map)

    slots: list[MatchSlot] = generator(team_ids)

    if clear_existing:
        clear_brackets(sport_id, db)

    # ── Create one bracket record per phase ───────────────────────────────────
    phases = dict.fromkeys(slot.bracket_phase for slot in slots)
    phase_to_bracket_id: dict[str, str] = {}
    bracket_ids_created: list[str] = []

    for phase in phases:
        phase_name = _PHASE_NAMES.get(phase, phase.title())
        result = db.table("brackets").insert({
            "sport_id": sport_id,
            "name": f"{division} — {phase_name}" if division else phase_name,
            "phase": phase,
            "division": division,
        }).execute()
        bid = result.data[0]["id"]
        phase_to_bracket_id[phase] = bid
        bracket_ids_created.append(bid)

    # ── Compute court and time assignments ───────────────────────────────────
    courts = list(location_ids) if location_ids else []
    assignment = _assign_courts_subtree(slots, courts)

    scheduled_at_map: dict[int, str] = {}
    if start_time is not None:
        scheduled_at_map = _compute_scheduled_times(
            slots, assignment, start_time, match_duration_minutes
        )

    # ── Batch-insert all match slots ─────────────────────────────────────────
    rows = []
    for i, slot in enumerate(slots):
        # Batch inserts must have identical keys on every row — PostgREST sends
        # explicit NULL for keys missing from some rows, bypassing column defaults.
        row: dict = {
            "sport_id": sport_id,
            "bracket_id": phase_to_bracket_id[slot.bracket_phase],
            "home_team_id": slot.home_team_id,
            "away_team_id": slot.away_team_id,
            "match_round": slot.match_round,
            "status": "scheduled",
            "home_slot_state": "tbd",
            "away_slot_state": "tbd",
        }
        if slot.is_bye:
            row["winner_id"] = slot.home_team_id or slot.away_team_id
            row["status"] = "completed"
            if slot.home_team_id is None:
                row["home_slot_state"] = "bye"
            if slot.away_team_id is None:
                row["away_slot_state"] = "bye"
        else:
            court = assignment.get(i)
            if court is not None:
                row["location_id"] = court
            # Grand final (court=None) gets location_id left null for dynamic assignment
            if i in scheduled_at_map:
                row["scheduled_at"] = scheduled_at_map[i]
        rows.append(row)

    result = db.table("matches").insert(rows).execute()
    inserted = result.data
    inserted_ids = [r["id"] for r in inserted]

    for i, slot in enumerate(slots):
        slot.db_id = inserted_ids[i]

    # ── Wire up next-match links ──────────────────────────────────────────────
    for i, slot in enumerate(slots):
        update: dict = {}
        if slot.winner_next_idx is not None:
            update["winner_next_match_id"] = inserted_ids[slot.winner_next_idx]
        if slot.loser_next_idx is not None:
            update["loser_next_match_id"] = inserted_ids[slot.loser_next_idx]
        if update:
            db.table("matches").update(update).eq("id", inserted_ids[i]).execute()

    # ── Advance bye winners into their next-round slots ───────────────────────
    for slot in slots:
        if not slot.is_bye or slot.winner_next_idx is None:
            continue
        winner_team = slot.home_team_id or slot.away_team_id
        next_id = inserted_ids[slot.winner_next_idx]
        _fill_team_slot(next_id, winner_team, db)

    # A bye match produces no loser — mark its losers-bracket slot as a
    # permanent bye so settle_bracket can auto-advance the team waiting there.
    for slot in slots:
        if slot.is_bye and slot.loser_next_idx is not None:
            _fill_bye_slot(inserted_ids[slot.loser_next_idx], db)

    # Identify the root match (no winner_next) so callers can chain brackets
    # together — e.g. wiring two division finals into a championship match.
    final_match_id = None
    max_round = 0
    for i, slot in enumerate(slots):
        if slot.is_bye:
            continue
        max_round = max(max_round, slot.match_round)
        if slot.winner_next_idx is None:
            final_match_id = inserted_ids[i]

    return {
        "bracket_ids": bracket_ids_created,
        "match_count": len(slots),
        "final_match_id": final_match_id,
        "max_round": max_round,
    }


def persist_pools(
    sport_id: str,
    pools: list[tuple[str, list[str], list[str]]],
    db: Client,
    clear_existing: bool = False,
    start_time: datetime | None = None,
    match_duration_minutes: int = 30,
    assumed_courts_per_group: int = 0,
) -> dict:
    """Generate and save round-robin pool play for a sport.

    Args:
        sport_id:              UUID of the sport.
        pools:                 List of (name, team_ids, location_ids) per pool.
        db:                    Supabase client (service role).
        clear_existing:        If True, delete existing brackets/matches first.
        start_time:            Earliest start time for the first match on each court.
        match_duration_minutes: Minutes per match slot on each court.

    Returns:
        Summary dict with bracket_ids and match_count.
    """
    if clear_existing:
        clear_brackets(sport_id, db)

    bracket_ids_created: list[str] = []

    # Pass 1: generate all round-robin slots and create bracket rows
    all_pool_data: list[tuple[str, list, list[str]]] = []  # (bracket_id, slots, courts)
    for p_idx, (pool_name, team_ids, pool_location_ids) in enumerate(pools):
        slots = round_robin.generate_round_robin(team_ids)
        bracket = db.table("brackets").insert({
            "sport_id": sport_id,
            "name": pool_name,
            "phase": "pool",
        }).execute().data[0]
        bracket_ids_created.append(bracket["id"])
        # When no explicit courts are given but assumed_courts_per_group > 0, create
        # virtual court IDs for scheduling math only (not written to match rows).
        effective_courts = list(pool_location_ids)
        if not effective_courts and assumed_courts_per_group > 0:
            effective_courts = [f"__virt_{p_idx}_{c}" for c in range(assumed_courts_per_group)]
        all_pool_data.append((bracket["id"], slots, effective_courts))

    # Pass 2+3: cohort-aware court assignment and scheduling.
    #
    # Processes (round_num, pool_idx) pairs in sorted order so that courts are
    # shared across pools without conflicts.  For each pool's round we pick the
    # field pair (a consecutive slice of that pool's declared courts sized by
    # matches_per_round) that becomes available earliest — accounting for both
    # court availability and the pool's own previous round finishing time.
    #
    # This produces the "cohort scheduling" pattern where groups with shared
    # courts are staggered automatically: e.g. 14 soccer pools sharing 6 fields
    # (3 pairs of 2) pack 3 pools per time slot and rotate field pairs each round.
    from collections import Counter

    pool_assignments: list[dict[int, str | None]] = [{} for _ in all_pool_data]
    scheduled_at: dict[tuple[int, int], str] = {}

    all_court_ids: set[str] = set()
    for _, _, courts in all_pool_data:
        all_court_ids.update(courts)

    if all_court_ids:
        duration = timedelta(minutes=match_duration_minutes)
        epoch = start_time if start_time is not None else datetime(2000, 1, 1)
        court_avail: dict[str, datetime] = {c: epoch for c in all_court_ids}
        pool_avail: list[datetime] = [epoch] * len(all_pool_data)

        # Build sorted queue of (round_num, pool_idx, [slot_indices])
        queue: list[tuple[int, int, list[int]]] = []
        for p_idx, (_, slots, courts) in enumerate(all_pool_data):
            if not courts:
                continue
            rmap: dict[int, list[int]] = {}
            for slot_idx, slot in enumerate(slots):
                rmap.setdefault(slot.match_round, []).append(slot_idx)
            for r, idxs in sorted(rmap.items()):
                queue.append((r, p_idx, idxs))
        queue.sort()

        for r, p_idx, slot_indices in queue:
            _, slots, courts = all_pool_data[p_idx]
            round_counts = Counter(s.match_round for s in slots)
            mpr = max(round_counts.values())

            n_courts = len(courts)
            if n_courts >= mpr:
                # All round matches can play simultaneously — pick the best court group
                field_pairs = [courts[i : i + mpr] for i in range(0, n_courts - mpr + 1, mpr)]

                def pair_ready(pair: list[str], _p: int = p_idx) -> datetime:
                    return max(pool_avail[_p], max(court_avail[c] for c in pair))

                best_pair = min(field_pairs, key=pair_ready)
                slot_time = pair_ready(best_pair)

                for i, slot_idx in enumerate(slot_indices):
                    pool_assignments[p_idx][slot_idx] = best_pair[i % len(best_pair)]
                    if start_time is not None:
                        scheduled_at[(p_idx, slot_idx)] = slot_time.isoformat()

                for c in best_pair:
                    court_avail[c] = slot_time + duration
                pool_avail[p_idx] = slot_time + duration
            else:
                # Fewer courts than matches per round — schedule in sequential batches of n_courts
                batch_time = max(pool_avail[p_idx], max(court_avail[c] for c in courts))
                for batch_start in range(0, len(slot_indices), n_courts):
                    batch = slot_indices[batch_start : batch_start + n_courts]
                    for i, slot_idx in enumerate(batch):
                        pool_assignments[p_idx][slot_idx] = courts[i % n_courts]
                        if start_time is not None:
                            scheduled_at[(p_idx, slot_idx)] = batch_time.isoformat()
                    for c in courts:
                        court_avail[c] = batch_time + duration
                    pool_avail[p_idx] = batch_time + duration
                    batch_time = batch_time + duration

    # Pass 4: insert match rows
    total_matches = 0
    for pool_idx, (bracket_id, slots, _courts) in enumerate(all_pool_data):
        rows = []
        for slot_idx, slot in enumerate(slots):
            row: dict = {
                "sport_id": sport_id,
                "bracket_id": bracket_id,
                "home_team_id": slot.home_team_id,
                "away_team_id": slot.away_team_id,
                "match_round": slot.match_round,
                "status": "scheduled",
                "home_slot_state": "tbd",
                "away_slot_state": "tbd",
            }
            court = pool_assignments[pool_idx].get(slot_idx)
            if court is not None and not court.startswith("__virt_"):
                row["location_id"] = court
            t = scheduled_at.get((pool_idx, slot_idx))
            if t is not None:
                row["scheduled_at"] = t
            rows.append(row)
        db.table("matches").insert(rows).execute()
        total_matches += len(rows)

    return {
        "bracket_ids": bracket_ids_created,
        "match_count": total_matches,
    }


def advance_winner(match_id: str, winner_id: str, loser_id: str | None, db: Client) -> None:
    """Push winner/loser into their next match slots after a result is posted."""
    match = db.table("matches").select(
        "winner_next_match_id, loser_next_match_id"
    ).eq("id", match_id).limit(1).execute()

    if not match.data:
        return

    row = match.data[0]
    if row.get("winner_next_match_id"):
        _fill_team_slot(row["winner_next_match_id"], winner_id, db)
    if loser_id and row.get("loser_next_match_id"):
        _fill_team_slot(row["loser_next_match_id"], loser_id, db)


def _fill_team_slot(match_id: str, team_id: str, db: Client) -> None:
    """Put team_id into the first empty, non-bye slot (home, then away) of a match."""
    row = db.table("matches").select(
        "home_team_id, away_team_id, home_slot_state, away_slot_state"
    ).eq("id", match_id).limit(1).execute()
    if not row.data:
        return
    slot = row.data[0]
    if slot["home_team_id"] == team_id or slot["away_team_id"] == team_id:
        return
    if slot["home_team_id"] is None and slot["home_slot_state"] != "bye":
        db.table("matches").update({"home_team_id": team_id}).eq("id", match_id).execute()
    elif slot["away_team_id"] is None and slot["away_slot_state"] != "bye":
        db.table("matches").update({"away_team_id": team_id}).eq("id", match_id).execute()


def _fill_bye_slot(match_id: str, db: Client) -> None:
    """Mark the first null, non-bye slot as a permanent bye (no team will ever fill it)."""
    row = db.table("matches").select(
        "home_team_id, away_team_id, home_slot_state, away_slot_state"
    ).eq("id", match_id).limit(1).execute()
    if not row.data:
        return
    slot = row.data[0]
    if slot["home_team_id"] is None and slot["home_slot_state"] != "bye":
        db.table("matches").update({"home_slot_state": "bye"}).eq("id", match_id).execute()
    elif slot["away_team_id"] is None and slot["away_slot_state"] != "bye":
        db.table("matches").update({"away_slot_state": "bye"}).eq("id", match_id).execute()


def advance_double_forfeit(match_id: str, db: Client) -> None:
    """After a double forfeit, neither team continues — mark both downstream
    slots (winner-advance and loser-drop) as permanent byes."""
    row = db.table("matches").select(
        "winner_next_match_id, loser_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not row.data:
        return
    for key in ("winner_next_match_id", "loser_next_match_id"):
        next_id = row.data[0].get(key)
        if next_id:
            _fill_bye_slot(next_id, db)


def _clear_team_from_slot(match_id: str, team_id: str, db: Client) -> None:
    """Set to NULL whichever slot in match_id contains team_id."""
    row = db.table("matches").select("home_team_id, away_team_id").eq("id", match_id).limit(1).execute()
    if not row.data:
        return
    slot = row.data[0]
    if slot["home_team_id"] == team_id:
        db.table("matches").update({"home_team_id": None}).eq("id", match_id).execute()
    elif slot["away_team_id"] == team_id:
        db.table("matches").update({"away_team_id": None}).eq("id", match_id).execute()


def retract_winner(match_id: str, winner_id: str, loser_id: str | None, db: Client) -> None:
    """Remove previously-advanced teams from downstream slots (called before re-submitting a result)."""
    match = db.table("matches").select(
        "winner_next_match_id, loser_next_match_id"
    ).eq("id", match_id).limit(1).execute()

    if not match.data:
        return

    row = match.data[0]
    if row.get("winner_next_match_id"):
        _clear_team_from_slot(row["winner_next_match_id"], winner_id, db)
    if loser_id and row.get("loser_next_match_id"):
        _clear_team_from_slot(row["loser_next_match_id"], loser_id, db)


def settle_bracket(sport_id: str, db: Client) -> None:
    """Sweep all bracket matches for a sport and auto-resolve anything that no longer needs a human decision."""
    _TERMINAL = {"completed", "forfeit", "double_forfeit"}

    changed = True
    while changed:
        changed = False

        rows = db.table("matches").select(
            "id, status, home_team_id, away_team_id, home_slot_state, away_slot_state, "
            "winner_next_match_id, loser_next_match_id"
        ).eq("sport_id", sport_id).execute().data

        terminal_ids = {r["id"] for r in rows if r["status"] in _TERMINAL}

        upstream_of: dict[str, list[str]] = {}
        for r in rows:
            for dst in filter(None, [r["winner_next_match_id"], r["loser_next_match_id"]]):
                upstream_of.setdefault(dst, []).append(r["id"])

        for m in rows:
            if m["status"] != "scheduled":
                continue

            if any(uid not in terminal_ids for uid in upstream_of.get(m["id"], [])):
                continue

            home_id = m["home_team_id"]
            away_id = m["away_team_id"]
            home_is_bye = home_id is None and m["home_slot_state"] == "bye"
            away_is_bye = away_id is None and m["away_slot_state"] == "bye"
            home_determined = home_id is not None or home_is_bye
            away_determined = away_id is not None or away_is_bye

            if not (home_determined and away_determined):
                continue

            if home_is_bye and away_is_bye:
                db.table("matches").update({"status": "double_forfeit"}).eq("id", m["id"]).execute()
                advance_double_forfeit(m["id"], db)
                changed = True
            elif home_is_bye or away_is_bye:
                solo = home_id or away_id
                db.table("matches").update(
                    {"winner_id": solo, "status": "completed"}
                ).eq("id", m["id"]).execute()
                if m["winner_next_match_id"]:
                    _fill_team_slot(m["winner_next_match_id"], solo, db)
                # A match won by bye has no real loser — bye out the loser slot too
                if m["loser_next_match_id"]:
                    _fill_bye_slot(m["loser_next_match_id"], db)
                changed = True
            # else: both slots have real teams — a human must play this match
