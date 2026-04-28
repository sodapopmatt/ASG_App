"""Bracket persistence layer.

Calls a pure generator, inserts brackets + matches into Supabase,
then wires up winner_next_match_id / loser_next_match_id links
and auto-completes any bye slots.
"""

import random

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
    """Shuffle teams randomly, then greedily resolve same-company first-round pairs.

    Works in the post-seeding index space: _seed_positions tells us which indices
    of the padded array become pairs in round 1. For each conflicting pair, we scan
    later pairs for a team from a different company and swap it in. If no valid swap
    exists (edge case), the same-company pair is left in place.
    """
    teams = list(team_ids)
    random.shuffle(teams)

    n = len(teams)
    size = _next_power_of_2(n)
    positions = _seed_positions(size)
    # positions[2k] and positions[2k+1] are the padded-array indices for pair k.
    # padded = teams + [None]*byes, so index >= n means a bye slot.

    num_pairs = size // 2
    for k in range(num_pairs):
        a_idx = positions[2 * k]
        b_idx = positions[2 * k + 1]

        if a_idx >= n or b_idx >= n:
            continue  # bye match — skip

        a = teams[a_idx]
        b = teams[b_idx]

        if company_map.get(a) != company_map.get(b):
            continue  # already different companies

        # Conflict: search later pairs for a valid swap partner for b.
        for j in range(k + 1, num_pairs):
            c_idx = positions[2 * j]
            d_idx = positions[2 * j + 1]

            if c_idx < n and company_map.get(teams[c_idx]) != company_map.get(a):
                teams[b_idx], teams[c_idx] = teams[c_idx], teams[b_idx]
                break

            if d_idx < n and company_map.get(teams[d_idx]) != company_map.get(a):
                teams[b_idx], teams[d_idx] = teams[d_idx], teams[b_idx]
                break
        # If no valid swap found, the same-company pair stands (unavoidable edge case).

    return teams


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
) -> dict:
    """Generate and save a bracket for a sport.

    Args:
        sport_id:       UUID of the sport.
        team_ids:       Team UUIDs ordered by seed (index 0 = top seed).
        db:             Supabase client (service role).
        clear_existing: If True, delete existing brackets/matches first.

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

    # ── Optionally clear existing brackets + matches ──────────────────────────
    if clear_existing:
        clear_brackets(sport_id, db)

    # ── Create one bracket record per phase ───────────────────────────────────
    phases = dict.fromkeys(slot.bracket_phase for slot in slots)  # preserves order
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

    # ── Batch-insert all match slots ─────────────────────────────────────────
    courts = list(location_ids) if location_ids else []
    court_cursor = 0

    rows = []
    for slot in slots:
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
        elif courts:
            # Round-robin across courts; byes are skipped so they don't consume a slot.
            row["location_id"] = courts[court_cursor % len(courts)]
            court_cursor += 1
        rows.append(row)

    result = db.table("matches").insert(rows).execute()
    inserted = result.data          # ordered the same as `rows`
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
    # If the team is already in either slot, nothing to do.
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
    """Sweep all bracket matches for a sport and auto-resolve anything that no longer needs a human decision.

    Runs in passes until no changes occur. Each pass resolves matches whose every
    upstream source has already been settled:
      - 2 teams present  → skip (needs a human result)
      - 1 team present   → auto-complete as a bye; advance that team
      - 0 teams present  → void the match (double_forfeit); advance nothing

    Call this after every match resolution (result, forfeit, double_forfeit).
    """
    _TERMINAL = {"completed", "forfeit", "double_forfeit"}

    changed = True
    while changed:
        changed = False

        rows = db.table("matches").select(
            "id, status, home_team_id, away_team_id, winner_next_match_id, loser_next_match_id"
        ).eq("sport_id", sport_id).execute().data

        terminal_ids = {r["id"] for r in rows if r["status"] in _TERMINAL}

        # upstream_of[match_id] = list of match IDs that feed into it
        upstream_of: dict[str, list[str]] = {}
        for r in rows:
            for dst in filter(None, [r["winner_next_match_id"], r["loser_next_match_id"]]):
                upstream_of.setdefault(dst, []).append(r["id"])

        for m in rows:
            if m["status"] != "scheduled":
                continue

            # Skip if any upstream source is still unresolved
            if any(uid not in terminal_ids for uid in upstream_of.get(m["id"], [])):
                continue

            home, away = m["home_team_id"], m["away_team_id"]

            if home and away:
                continue  # two teams — needs a human result

            if home or away:
                solo = home or away
                db.table("matches").update(
                    {"winner_id": solo, "status": "completed"}
                ).eq("id", m["id"]).execute()
                if m["winner_next_match_id"]:
                    _fill_team_slot(m["winner_next_match_id"], solo, db)
                changed = True

            else:
                # No teams will ever arrive — void the match
                db.table("matches").update(
                    {"status": "double_forfeit"}
                ).eq("id", m["id"]).execute()
                changed = True
