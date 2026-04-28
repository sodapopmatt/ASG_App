"""Bracket persistence layer.

Calls a pure generator, inserts brackets + matches into Supabase,
then wires up winner_next_match_id / loser_next_match_id links
and auto-completes any bye slots.
"""

import math
import random
from datetime import datetime, timedelta

from supabase import Client
from .types import MatchSlot
from . import single_elim, double_elim
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


def _shuffle_avoiding_same_company(
    team_ids: list[str],
    company_map: dict[str, str],
) -> list[str]:
    """Shuffle teams randomly, then greedily resolve same-company first-round pairs."""
    teams = list(team_ids)
    random.shuffle(teams)

    n = len(teams)
    size = _next_power_of_2(n)
    positions = _seed_positions(size)

    num_pairs = size // 2
    for k in range(num_pairs):
        a_idx = positions[2 * k]
        b_idx = positions[2 * k + 1]

        if a_idx >= n or b_idx >= n:
            continue

        a = teams[a_idx]
        b = teams[b_idx]

        if company_map.get(a) != company_map.get(b):
            continue

        for j in range(k + 1, num_pairs):
            c_idx = positions[2 * j]
            d_idx = positions[2 * j + 1]

            if c_idx < n and company_map.get(teams[c_idx]) != company_map.get(a):
                teams[b_idx], teams[c_idx] = teams[c_idx], teams[b_idx]
                break

            if d_idx < n and company_map.get(teams[d_idx]) != company_map.get(a):
                teams[b_idx], teams[d_idx] = teams[d_idx], teams[b_idx]
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

    # Winners bracket: group R1 into C blocks then propagate up
    wb_phases = {"winners", "bracket"}
    wb_non_bye = [i for i, s in enumerate(slots) if s.bracket_phase in wb_phases and not s.is_bye]

    if wb_non_bye:
        min_round = min(slots[i].match_round for i in wb_non_bye)
        r1 = [i for i in wb_non_bye if slots[i].match_round == min_round]

        # Adjacent R1 pairs feed the same R2 match, so assign in contiguous blocks
        group_size = max(1, len(r1) // C)
        for pos, i in enumerate(r1):
            court_idx = min(pos // group_size, C - 1)
            assignment[i] = courts[court_idx]

        # Propagate court up through winner_next_idx (slots are ordered by round,
        # so iterating by index is already topological order within the WB)
        for i, s in enumerate(slots):
            if s.bracket_phase not in wb_phases or s.is_bye:
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


def clear_brackets(sport_id: str, db: Client) -> None:
    """Delete all brackets and matches for a sport, safely handling FK self-references."""
    existing = db.table("brackets").select("id").eq("sport_id", sport_id).execute()
    bracket_ids = [b["id"] for b in existing.data]
    for bid in bracket_ids:
        db.table("matches").update({
            "winner_next_match_id": None,
            "loser_next_match_id": None,
        }).eq("bracket_id", bid).execute()
        db.table("matches").delete().eq("bracket_id", bid).execute()
        db.table("brackets").delete().eq("id", bid).execute()


def persist_bracket(
    sport_id: str,
    team_ids: list[str],
    db: Client,
    clear_existing: bool = False,
    location_ids: list[str] | None = None,
    start_time: datetime | None = None,
    match_duration_minutes: int = 30,
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

    Returns:
        Summary dict with bracket_ids and match_count.

    Raises:
        ValueError: If the sport's bracket_type has no generator yet.
    """
    sport_row = db.table("sports").select("bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport_row.data:
        raise ValueError("Sport not found")

    bracket_type: str = sport_row.data[0]["bracket_type"]
    generator = _GENERATORS.get(bracket_type)
    if generator is None:
        raise ValueError(
            f"Bracket generation is not yet supported for '{bracket_type}'. "
            "Enter results and placements manually for this sport."
        )

    company_map = _fetch_company_map(team_ids, db)
    team_ids = _shuffle_avoiding_same_company(team_ids, company_map)

    slots: list[MatchSlot] = generator(team_ids)

    if clear_existing:
        clear_brackets(sport_id, db)

    # ── Create one bracket record per phase ───────────────────────────────────
    phases = dict.fromkeys(slot.bracket_phase for slot in slots)
    phase_to_bracket_id: dict[str, str] = {}
    bracket_ids_created: list[str] = []

    for phase in phases:
        result = db.table("brackets").insert({
            "sport_id": sport_id,
            "name": _PHASE_NAMES.get(phase, phase.title()),
            "phase": phase,
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
        row: dict = {
            "sport_id": sport_id,
            "bracket_id": phase_to_bracket_id[slot.bracket_phase],
            "home_team_id": slot.home_team_id,
            "away_team_id": slot.away_team_id,
            "match_round": slot.match_round,
            "status": "scheduled",
        }
        if slot.is_bye:
            row["winner_id"] = slot.home_team_id or slot.away_team_id
            row["status"] = "completed"
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

    return {
        "bracket_ids": bracket_ids_created,
        "match_count": len(slots),
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
    """Put team_id into the first empty slot (home, then away) of a match."""
    row = db.table("matches").select("home_team_id, away_team_id").eq("id", match_id).limit(1).execute()
    if not row.data:
        return
    slot = row.data[0]
    if slot["home_team_id"] == team_id or slot["away_team_id"] == team_id:
        return
    field = "home_team_id" if slot["home_team_id"] is None else "away_team_id"
    db.table("matches").update({field: team_id}).eq("id", match_id).execute()


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
            "id, status, home_team_id, away_team_id, winner_next_match_id, loser_next_match_id"
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

            home, away = m["home_team_id"], m["away_team_id"]

            if home and away:
                continue

            if home or away:
                solo = home or away
                db.table("matches").update(
                    {"winner_id": solo, "status": "completed"}
                ).eq("id", m["id"]).execute()
                if m["winner_next_match_id"]:
                    _fill_team_slot(m["winner_next_match_id"], solo, db)
                changed = True

            else:
                db.table("matches").update(
                    {"status": "double_forfeit"}
                ).eq("id", m["id"]).execute()
                changed = True
