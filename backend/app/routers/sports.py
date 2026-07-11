from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.database import supabase
from app.auth import require_admin
from app.schemas.sport import Sport, SportCreate, SportUpdate
from app.bracket_engine import persist_bracket, persist_pools, clear_brackets, clear_bracket_phase
from app.bracket_engine.generator import advance_winner, advance_double_forfeit, settle_bracket
from pydantic import BaseModel

router = APIRouter()


class DivisionSpec(BaseModel):
    name: str                 # e.g. "Main Gym"
    team_ids: list[str]       # ordered by seed within the division
    location_ids: list[str] = []  # this division's courts (subset of the sport's locations)


class PoolSpec(BaseModel):
    name: str                 # e.g. "Pool A"
    team_ids: list[str]       # teams in this pool (round-robin: order doesn't matter)
    location_ids: list[str] = []  # this pool's courts (subset of the sport's locations)


class HeatSpec(BaseModel):
    name: str                        # e.g. "Preliminary Heat 1", "Semi-Final Heat 1", "Final"
    team_ids: list[str]
    phase: str = "heats"             # heats | bracket | finals
    scheduled_at: str | None = None  # ISO timestamp; if omitted, derived from schedule_start


class SeedOrderRequest(BaseModel):
    team_ids: list[str]  # ordered â€” index 0 is the top seed


class PoolSetupRequest(BaseModel):
    pool_count: int | None = None
    team_pool: dict[str, int] = {}   # team_id -> pool index override (-2 = unassigned)
    court_pool: dict[str, int] = {}  # location_id -> pool index override (-1 = shared)


class GenerateBracketRequest(BaseModel):
    team_ids: list[str] = []  # ordered by seed â€” index 0 is the top seed
    clear_existing: bool = False
    # When set (elimination only): one independent bracket per division, each on
    # its own courts, with the division finals feeding a single championship match.
    divisions: list[DivisionSpec] | None = None
    # When set (pool types only): one round-robin pool per entry, each on its own
    # courts. For pool_bracket sports the elimination phase is generated later by
    # calling this endpoint again with team_ids seeded from pool standings.
    pools: list[PoolSpec] | None = None
    # When set (heats only): one bracket per heat, one match per team per heat.
    # Supports multi-phase tournaments (preliminary â†’ semi-finals â†’ final).
    heats: list[HeatSpec] | None = None


@router.get("", response_model=list[Sport])
def list_sports():
    return supabase.table("sports").select("*").order("name").execute().data


@router.get("/{sport_id}", response_model=Sport)
def get_sport(sport_id: str):
    response = supabase.table("sports").select("*").eq("id", sport_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    return response.data[0]


@router.post("", response_model=Sport, status_code=201)
def create_sport(body: SportCreate, _=Depends(require_admin)):
    return supabase.table("sports").insert(body.model_dump()).execute().data[0]


@router.patch("/{sport_id}", response_model=Sport)
def update_sport(sport_id: str, body: SportUpdate, _=Depends(require_admin)):
    # exclude_unset (not exclude_none): a field the caller explicitly sends as
    # null means "clear it" (e.g. pool_play_rounds back to full round robin);
    # exclude_none would silently drop that key and leave the old value in place.
    updates = body.model_dump(exclude_unset=True, mode="json")
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    return supabase.table("sports").update(updates).eq("id", sport_id).execute().data[0]


@router.delete("/{sport_id}", status_code=204)
def delete_sport(sport_id: str, _=Depends(require_admin)):
    supabase.table("sports").delete().eq("id", sport_id).execute()


@router.delete("/{sport_id}/brackets", status_code=204)
def reset_brackets(sport_id: str, _=Depends(require_admin)):
    """Delete all brackets and matches for a sport without regenerating.
    For heats sports, also clears event_points since they are derived from match results."""
    sport = supabase.table("sports").select("id, bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    clear_brackets(sport_id, supabase)
    if sport.data[0].get("bracket_type") == "heats":
        supabase.table("event_points").delete().eq("sport_id", sport_id).execute()


@router.delete("/{sport_id}/bracket-phase", status_code=204)
def reset_bracket_phase(sport_id: str, _=Depends(require_admin)):
    """Delete only the seeded elimination bracket phase for a pool_bracket sport
    (phase != 'pool'), leaving pool play matches and standings untouched. Lets an
    admin restart the bracket-phase seeding without wiping pool results."""
    sport = supabase.table("sports").select("id, bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    if sport.data[0].get("bracket_type") != "pool_bracket":
        raise HTTPException(status_code=422, detail="Only pool_bracket sports have a separate bracket phase")
    clear_bracket_phase(sport_id, supabase)


@router.put("/{sport_id}/seed-order", status_code=204)
def set_seed_order(sport_id: str, body: SeedOrderRequest, _=Depends(require_admin)):
    """Persist a full seed order in one request via a single bulk upsert,
    rather than one sequential PATCH per team — see set_pool_setup's
    docstring for why a per-row loop doesn't scale (observed crashing at
    ~100+ teams) and why a full-row upsert is required (partial-column
    upserts null out any NOT NULL column not included)."""
    if not body.team_ids:
        return
    existing = (
        supabase.table("teams").select("*")
        .in_("id", body.team_ids).eq("sport_id", sport_id)
        .execute().data
    )
    seed_by_id = {team_id: i for i, team_id in enumerate(body.team_ids)}
    rows = []
    for row in existing:
        row = dict(row)
        row["seed"] = seed_by_id[row["id"]]
        rows.append(row)
    if rows:
        supabase.table("teams").upsert(rows).execute()


@router.put("/{sport_id}/pool-setup", status_code=204)
def set_pool_setup(sport_id: str, body: PoolSetupRequest, _=Depends(require_admin)):
    """Persist pool count + team/court pool overrides in one request.

    team_pool/court_pool updates are applied via one bulk upsert each rather
    than one sequential round-trip per row. With ~100+ teams (e.g. Pickleball)
    the old per-row loop took 10+ seconds and could exhaust the Supabase
    client's connection pool outright (observed as a live 500 mid-loop).
    Supabase's upsert replaces the WHOLE row for any column not included in
    the payload (confirmed empirically: NOT NULL columns omitted come back as
    NULL), so each row must carry its other columns forward unchanged — pull
    the full existing rows first, only overwrite pool_index, upsert the rest
    as-is.
    """
    if body.pool_count is not None:
        supabase.table("sports").update({"pool_count": body.pool_count}).eq("id", sport_id).execute()

    if body.team_pool:
        existing = (
            supabase.table("teams").select("*")
            .in_("id", list(body.team_pool.keys())).eq("sport_id", sport_id)
            .execute().data
        )
        rows = []
        for row in existing:
            row = dict(row)
            row["pool_index"] = body.team_pool[row["id"]]
            rows.append(row)
        if rows:
            supabase.table("teams").upsert(rows).execute()

    if body.court_pool:
        existing = (
            supabase.table("locations").select("*")
            .in_("id", list(body.court_pool.keys())).eq("sport_id", sport_id)
            .execute().data
        )
        rows = []
        for row in existing:
            row = dict(row)
            row["pool_index"] = body.court_pool[row["id"]]
            rows.append(row)
        if rows:
            supabase.table("locations").upsert(rows).execute()


@router.post("/{sport_id}/generate-bracket")
def generate_bracket(sport_id: str, body: GenerateBracketRequest, _=Depends(require_admin)):
    """Generate brackets and matches for a sport from a seeded list of team IDs.

    Scheduling config (match_duration_minutes, schedule_start) is read from the
    sport record. Courts are read from the sport's locations table.

    Supports: single_elimination, double_elimination, heats, and pool types.
    Pool types (pool_bracket, pool_swiss) take `pools` to generate round-robin
    pool play; pool_bracket sports later take `team_ids` (seeded from pool
    standings) to generate the single-elimination bracket phase.
    Other combinations return a 422.
    """
    sport_row = supabase.table("sports").select(
        "name, bracket_type, scoring_mode, match_duration_minutes, schedule_start, assumed_courts_per_group, pool_play_rounds"
    ).eq("id", sport_id).limit(1).execute()

    if not sport_row.data:
        raise HTTPException(status_code=404, detail="Sport not found")

    sport = sport_row.data[0]
    bracket_type = sport.get("bracket_type")

    if body.divisions is not None and bracket_type not in ("single_elimination", "double_elimination"):
        raise HTTPException(status_code=422, detail="Divisions are only supported for elimination brackets")

    if body.divisions is not None and sport.get("name") != "Basketball":
        raise HTTPException(status_code=422, detail="Divisions are only supported for Basketball")

    if body.pools is not None and bracket_type not in ("pool_bracket", "pool_swiss"):
        raise HTTPException(status_code=422, detail="Pools are only supported for pool-based bracket types")

    if body.pools is not None and body.divisions is not None:
        raise HTTPException(status_code=422, detail="Pools and divisions cannot be combined")

    # Fetch this sport's named courts
    sport_locations = (
        supabase.table("locations")
        .select("id")
        .eq("sport_id", sport_id)
        .order("name")
        .execute()
        .data
    )
    location_ids = [loc["id"] for loc in sport_locations]

    # Heats: one match per team. Supports grouped heats (body.heats) or flat list.
    if bracket_type == "heats":
        from datetime import datetime, timezone, timedelta

        teams_resp = supabase.table("teams").select("id").eq("sport_id", sport_id).execute()
        valid_ids = {t["id"] for t in teams_resp.data}
        duration = sport.get("match_duration_minutes") or 30

        start_time = None
        raw_start = sport.get("schedule_start")
        if raw_start:
            if isinstance(raw_start, str):
                start_time = datetime.fromisoformat(raw_start.replace("Z", "+00:00"))
            else:
                start_time = raw_start

        is_golf = sport.get("scoring_mode") == "executive_golf"

        if body.heats is not None:
            # Grouped heats: one bracket per heat, one match per team
            all_team_ids = [tid for h in body.heats for tid in h.team_ids]
            invalid = [tid for tid in all_team_ids if tid not in valid_ids]
            if invalid:
                raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")

            total_matches = 0
            for i, heat in enumerate(body.heats):
                bracket_row = supabase.table("brackets").insert({
                    "sport_id": sport_id,
                    "name": heat.name,
                    "phase": heat.phase,
                }).execute().data[0]
                bracket_id = bracket_row["id"]

                heat_start = heat.scheduled_at
                if heat_start is None and start_time:
                    offset_minutes = i * duration
                    heat_start = (start_time + timedelta(minutes=offset_minutes)).isoformat()
                heat_start_dt = datetime.fromisoformat(heat_start.replace("Z", "+00:00")) if heat_start else None

                # All teams in a heat race simultaneously at the same location —
                # EXCEPT Executive Golf, where companies tee off individually on
                # the shared tee, one after another, not as a group. Storing each
                # team's own scheduled_at (rather than one shared value) keeps it
                # matching the dynamic estimated_start once matches are read back,
                # so the schedule doesn't flag them as "pushed" from day one.
                heat_location_id = location_ids[i % len(location_ids)] if location_ids else None

                heat_rows = []
                for ti, team_id in enumerate(heat.team_ids):
                    row: dict = {
                        "sport_id": sport_id,
                        "bracket_id": bracket_id,
                        "home_team_id": team_id,
                        "status": "scheduled",
                        "match_round": 1,
                    }
                    if is_golf:
                        if heat_start_dt:
                            row["scheduled_at"] = (heat_start_dt + timedelta(minutes=ti * duration)).isoformat()
                    elif heat_start:
                        row["scheduled_at"] = heat_start
                    if heat_location_id:
                        row["location_id"] = heat_location_id
                    heat_rows.append(row)
                # One bulk insert per heat instead of one round-trip per team —
                # see set_pool_setup's docstring for why a per-row loop doesn't
                # scale (a large heat/team count risks the same crash).
                if heat_rows:
                    supabase.table("matches").insert(heat_rows).execute()
                    total_matches += len(heat_rows)

            return {"matches_created": total_matches}

        # Flat mode (backward compatibility): one match per team, no bracket
        if len(body.team_ids) < 1:
            raise HTTPException(status_code=422, detail="At least 1 team is required")

        invalid = [tid for tid in body.team_ids if tid not in valid_ids]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")

        if body.clear_existing:
            clear_brackets(sport_id, supabase)

        concurrent = len(location_ids) or 1
        rows = []
        for i, team_id in enumerate(body.team_ids):
            round_num = i // concurrent + 1
            scheduled_at = None
            if start_time:
                offset_minutes = (round_num - 1) * duration
                scheduled_at = (start_time + timedelta(minutes=offset_minutes)).isoformat()

            row: dict = {
                "sport_id": sport_id,
                "home_team_id": team_id,
                "away_team_id": None,
                "status": "scheduled",
                "match_round": round_num,
            }
            if scheduled_at:
                row["scheduled_at"] = scheduled_at
            if location_ids:
                row["location_id"] = location_ids[i % concurrent]
            rows.append(row)

        # One bulk insert instead of one round-trip per team — see
        # set_pool_setup's docstring for why the per-row version doesn't scale.
        matches = supabase.table("matches").insert(rows).execute().data if rows else []
        return {"matches_created": len(matches)}

    teams = supabase.table("teams").select("id").eq("sport_id", sport_id).execute()
    valid_ids = {t["id"] for t in teams.data}

    duration = sport.get("match_duration_minutes") or 30

    start_time = None
    raw_start = sport.get("schedule_start")
    if raw_start:
        from datetime import datetime, timezone
        if isinstance(raw_start, str):
            start_time = datetime.fromisoformat(raw_start.replace("Z", "+00:00"))
        else:
            start_time = raw_start

    if body.divisions is not None:
        return _generate_division_brackets(
            sport_id, body, valid_ids, location_ids, start_time, duration
        )

    if body.pools is not None:
        return _generate_pool_play(
            sport_id, body, valid_ids, location_ids, start_time, duration,
            assumed_courts_per_group=sport.get("assumed_courts_per_group") or 0,
            max_rounds=sport.get("pool_play_rounds"),
        )

    # Pool types without `pools`: pool_bracket generates its seeded bracket
    # phase alongside the existing pool matches; pool_swiss has no generator yet.
    bracket_type_override = None
    shuffle = True
    if bracket_type == "pool_swiss":
        raise HTTPException(
            status_code=422,
            detail="Swiss round generation is not yet supported. Generate pools, then create championship matches manually.",
        )
    if bracket_type == "pool_bracket":
        if body.clear_existing:
            raise HTTPException(
                status_code=422,
                detail="clear_existing would delete the pool matches. Use DELETE /sports/{id}/brackets to reset everything.",
            )
        bracket_type_override = "single_elimination"
        shuffle = False  # team_ids are seeded from pool standings â€” keep the order
        start_time = _after_last_scheduled_match(sport_id, start_time, duration)

    # Elimination brackets require at least 2 teams
    if len(body.team_ids) < 2:
        raise HTTPException(status_code=422, detail="At least 2 teams are required")

    invalid = [tid for tid in body.team_ids if tid not in valid_ids]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")

    try:
        result = persist_bracket(
            sport_id=sport_id,
            team_ids=body.team_ids,
            db=supabase,
            clear_existing=body.clear_existing,
            location_ids=location_ids,
            start_time=start_time,
            match_duration_minutes=duration,
            bracket_type_override=bracket_type_override,
            shuffle=shuffle,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


def _generate_division_brackets(
    sport_id: str,
    body: GenerateBracketRequest,
    valid_ids: set[str],
    sport_location_ids: list[str],
    start_time,
    duration: int,
) -> dict:
    """Generate one independent bracket per division, each on its own courts,
    then create a championship match that both division finals feed into via
    winner_next_match_id. Advancement, retraction, and settle_bracket all work
    unchanged because they only follow next-match links."""
    divisions = body.divisions or []
    if len(divisions) < 2:
        raise HTTPException(status_code=422, detail="At least 2 divisions are required")

    all_team_ids = [tid for d in divisions for tid in d.team_ids]
    if len(set(all_team_ids)) != len(all_team_ids):
        raise HTTPException(status_code=422, detail="A team cannot be in more than one division")
    invalid = [tid for tid in all_team_ids if tid not in valid_ids]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")
    for d in divisions:
        if len(d.team_ids) < 2:
            raise HTTPException(status_code=422, detail=f"Division '{d.name}' needs at least 2 teams")
        if not d.name.strip():
            raise HTTPException(status_code=422, detail="Every division needs a name")
    names = [d.name.strip() for d in divisions]
    if len(set(names)) != len(names):
        raise HTTPException(status_code=422, detail="Division names must be unique")

    all_location_ids = [lid for d in divisions for lid in d.location_ids]
    if len(set(all_location_ids)) != len(all_location_ids):
        raise HTTPException(status_code=422, detail="A court cannot be assigned to more than one division")
    sport_location_set = set(sport_location_ids)
    bad_locations = [lid for lid in all_location_ids if lid not in sport_location_set]
    if bad_locations:
        raise HTTPException(status_code=422, detail=f"Courts not found for this sport: {bad_locations}")

    if body.clear_existing:
        clear_brackets(sport_id, supabase)

    results = []
    try:
        for d in divisions:
            results.append(persist_bracket(
                sport_id=sport_id,
                team_ids=d.team_ids,
                db=supabase,
                clear_existing=False,
                location_ids=d.location_ids,
                start_time=start_time,
                match_duration_minutes=duration,
                division=d.name.strip(),
            ))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Championship: one match in its own finals bracket; each division's root
    # match advances its winner here. Court is left unassigned (dynamic â€” the
    # first division to finish claims its court; admins can PATCH location_id).
    championship_bracket = supabase.table("brackets").insert({
        "sport_id": sport_id,
        "name": "Championship",
        "phase": "finals",
    }).execute().data[0]

    championship_round = max(r["max_round"] for r in results) + 1
    championship = supabase.table("matches").insert({
        "sport_id": sport_id,
        "bracket_id": championship_bracket["id"],
        "match_round": championship_round,
        "status": "scheduled",
    }).execute().data[0]

    for r in results:
        if r.get("final_match_id"):
            supabase.table("matches").update(
                {"winner_next_match_id": championship["id"]}
            ).eq("id", r["final_match_id"]).execute()

    return {
        "bracket_ids": [bid for r in results for bid in r["bracket_ids"]] + [championship_bracket["id"]],
        "match_count": sum(r["match_count"] for r in results) + 1,
        "championship_match_id": championship["id"],
    }


def _after_last_scheduled_match(sport_id: str, start_time, duration: int):
    """Start time for the bracket phase: one slot after the sport's last
    scheduled match (i.e. after pool play wraps up), or the sport's
    schedule_start when nothing is scheduled yet."""
    from datetime import datetime, timedelta

    rows = (
        supabase.table("matches")
        .select("scheduled_at")
        .eq("sport_id", sport_id)
        .not_.is_("scheduled_at", "null")
        .order("scheduled_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return start_time
    last = datetime.fromisoformat(rows[0]["scheduled_at"].replace("Z", "+00:00"))
    return last + timedelta(minutes=duration)


def _generate_pool_play(
    sport_id: str,
    body: GenerateBracketRequest,
    valid_ids: set[str],
    sport_location_ids: list[str],
    start_time,
    duration: int,
    assumed_courts_per_group: int = 0,
    max_rounds: int | None = None,
) -> dict:
    """Generate one round-robin pool per PoolSpec, each on its own courts.

    `max_rounds` (the sport's `pool_play_rounds`) truncates each pool to that
    many games per team; None generates a full round robin.
    """
    pools = body.pools or []
    if len(pools) < 1:
        raise HTTPException(status_code=422, detail="At least 1 pool is required")

    # Guard against orphan-bracket accumulation: if pool brackets already exist
    # and the caller didn't ask to clear them, reject now before creating more.
    if not body.clear_existing:
        existing = (
            supabase.table("brackets")
            .select("id")
            .eq("sport_id", sport_id)
            .eq("phase", "pool")
            .limit(1)
            .execute()
            .data
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Pool play already generated. Use 'Restart Pool Play' to reset before regenerating.",
            )

    all_team_ids = [tid for p in pools for tid in p.team_ids]
    if len(set(all_team_ids)) != len(all_team_ids):
        raise HTTPException(status_code=422, detail="A team cannot be in more than one pool")
    invalid = [tid for tid in all_team_ids if tid not in valid_ids]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")
    for p in pools:
        if len(p.team_ids) < 2:
            raise HTTPException(status_code=422, detail=f"Pool '{p.name}' needs at least 2 teams")
        if not p.name.strip():
            raise HTTPException(status_code=422, detail="Every pool needs a name")
    names = [p.name.strip() for p in pools]
    if len(set(names)) != len(names):
        raise HTTPException(status_code=422, detail="Pool names must be unique")

    # Unlike divisions, pools MAY legitimately share courts — persist_pools's
    # cohort-scheduling pass (below) is built specifically to stagger many
    # pools across a smaller set of shared fields in time (e.g. 14 pools on
    # 6 courts), so a court appearing in multiple pools' location_ids is the
    # normal, supported input, not a conflict.
    all_location_ids = [lid for p in pools for lid in p.location_ids]
    sport_location_set = set(sport_location_ids)
    bad_locations = [lid for lid in all_location_ids if lid not in sport_location_set]
    if bad_locations:
        raise HTTPException(status_code=422, detail=f"Courts not found for this sport: {bad_locations}")

    try:
        return persist_pools(
            sport_id=sport_id,
            pools=[(p.name.strip(), p.team_ids, p.location_ids) for p in pools],
            db=supabase,
            clear_existing=body.clear_existing,
            start_time=start_time,
            match_duration_minutes=duration,
            assumed_courts_per_group=assumed_courts_per_group,
            max_rounds=max_rounds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


_TERMINAL_STATUSES = {"completed", "forfeit", "double_forfeit", "draw"}


def _build_records(matches: list[dict], is_pool_swiss: bool = False) -> dict[str, dict]:
    """Compute standings records from a list of terminal matches.

    For pool_swiss sports (Cornhole), tournament_points are computed as:
      4 pts for a regular win, 2 pts for a forfeit win, 1 pt for a draw, 0 for a loss.
    For all other sports, tournament_points = 4*wins + 1*draws (forfeit wins treated same as wins).
    goals_for/goal_diff are populated from home_score/away_score (cornhole game scores).
    """
    records: dict[str, dict] = {}

    def record(team_id: str) -> dict:
        return records.setdefault(team_id, {
            "team_id": team_id,
            "wins": 0,
            "forfeit_wins": 0,
            "draws": 0,
            "losses": 0,
            "played": 0,
            "tournament_points": 0,
            "goals_for": 0,
            "goals_against": 0,
            "goal_diff": 0,
            "game_wins": 0,
            "point_diff": 0,
            "total_points": 0,
        })

    for m in matches:
        home, away = m["home_team_id"], m["away_team_id"]
        for tid in (home, away):
            if tid:
                record(tid)
        if m["status"] not in _TERMINAL_STATUSES or not home or not away:
            continue

        hgw = m.get("home_games_won") or 0
        agw = m.get("away_games_won") or 0
        hpt = m.get("home_points_total") or 0
        apt = m.get("away_points_total") or 0
        hs = m.get("home_score") or 0
        as_ = m.get("away_score") or 0

        if m["status"] == "double_forfeit":
            for tid in (home, away):
                record(tid)["losses"] += 1
                record(tid)["played"] += 1
        elif m["status"] == "draw":
            for tid in (home, away):
                record(tid)["draws"] += 1
                record(tid)["played"] += 1
                record(tid)["tournament_points"] += 1
        elif m["winner_id"] in (home, away):
            loser = away if m["winner_id"] == home else home
            winner_id = m["winner_id"]
            is_forfeit = m["status"] == "forfeit"
            record(winner_id)["wins"] += 1
            record(winner_id)["played"] += 1
            record(loser)["losses"] += 1
            record(loser)["played"] += 1
            if is_forfeit and is_pool_swiss:
                record(winner_id)["forfeit_wins"] += 1
                record(winner_id)["tournament_points"] += 2
            else:
                record(winner_id)["tournament_points"] += 4

        record(home)["goals_for"] += hs
        record(home)["goals_against"] += as_
        record(home)["goal_diff"] += hs - as_
        record(away)["goals_for"] += as_
        record(away)["goals_against"] += hs
        record(away)["goal_diff"] += as_ - hs
        record(home)["game_wins"] += hgw
        record(home)["point_diff"] += hpt - apt
        record(home)["total_points"] += hpt
        record(away)["game_wins"] += agw
        record(away)["point_diff"] += apt - hpt
        record(away)["total_points"] += apt

    return records


def _head_to_head_winner(matches: list[dict], team_a: str, team_b: str) -> str | None:
    """Return the decisive winner of the direct match between two teams, if any.

    Only a `completed`/`forfeit` result counts — a draw or double_forfeit has no
    winner to hand a tiebreak to, and a pair that never played (e.g. a truncated
    round robin) has no match at all here.
    """
    for m in matches:
        if {m.get("home_team_id"), m.get("away_team_id")} != {team_a, team_b}:
            continue
        if m.get("status") in ("completed", "forfeit") and m.get("winner_id") in (team_a, team_b):
            return m["winner_id"]
    return None


def _rank_standings(records: dict[str, dict], matches: list[dict] | None = None, is_pool_swiss: bool = False) -> list[dict]:
    """Sort and assign ranks to standings records.

    pool_swiss (Cornhole): sort by tournament_points â†’ goal_diff â†’ goals_for.
    Cornhole is scored by bag points, so this ranking is intentionally
    score-based (see docstrings above on tournament_points / goal_diff).

    Others (pool_bracket: Soccer, Ultimate Frisbee, Pickleball): wins desc is
    the primary criterion (this is what "pool winner" means per the
    rulebook). Ties on wins are broken, in order: head-to-head (only
    meaningful for a straight 2-team tie â€” a 3+-way tie can't be resolved by
    one match) â†’ point differential desc â†’ total points scored desc. For
    sports that don't track point_diff/total_points (Soccer, Ultimate
    Frisbee â€” those fields stay 0), this silently falls through to a shared
    rank, same as before. A tie that survives every criterion still shares a
    rank; the admin resolves it manually when seeding the bracket phase.
    """
    if is_pool_swiss:
        standings = sorted(
            records.values(),
            key=lambda r: (-r["tournament_points"], -r["goal_diff"], -r["goals_for"]),
        )
        prev_key = None
        for i, row in enumerate(standings):
            key = (row["tournament_points"], row["goal_diff"], row["goals_for"])
            row["rank"] = standings[i - 1]["rank"] if key == prev_key else i + 1
            prev_key = key
        return standings

    matches = matches or []
    by_wins: dict[int, list[dict]] = {}
    for r in records.values():
        by_wins.setdefault(r["wins"], []).append(r)

    standings: list[dict] = []
    # Parallel list: the key used purely to decide whether two adjacent rows
    # are a genuine, unresolved tie (and so should share a rank number).
    distinct_keys: list[tuple] = []

    for wins in sorted(by_wins.keys(), reverse=True):
        group = by_wins[wins]
        if len(group) == 2:
            a, b = group
            winner_id = _head_to_head_winner(matches, a["team_id"], b["team_id"])
            if winner_id in (a["team_id"], b["team_id"]):
                ordered = [a, b] if winner_id == a["team_id"] else [b, a]
                standings.extend(ordered)
                # Head-to-head decisively separates these two regardless of
                # point_diff/total_points, so give them distinct keys.
                distinct_keys.append((wins, "h2h", 0))
                distinct_keys.append((wins, "h2h", 1))
                continue
        ordered = sorted(group, key=lambda r: (-r["point_diff"], -r["total_points"]))
        standings.extend(ordered)
        distinct_keys.extend((wins, row["point_diff"], row["total_points"]) for row in ordered)

    prev_key = None
    for i, row in enumerate(standings):
        key = distinct_keys[i]
        row["rank"] = standings[i - 1]["rank"] if key == prev_key else i + 1
        prev_key = key
    return standings


@router.get("/{sport_id}/standings")
def get_standings(sport_id: str):
    """W/D/L standings per pool, computed from terminal matches.

    completed/forfeit â†’ win for winner, loss for opponent
    draw â†’ both teams get a draw
    double_forfeit â†’ both teams get a loss

    pool_swiss sports (Cornhole): tournament_points = 4*wins + 2*forfeit_wins + 1*draws.
    Ranking: tournament_points desc â†’ goal_diff desc â†’ goals_for desc.
    Other sports (pool_bracket): wins desc â†’ head-to-head (2-team ties only) â†’
    point_diff desc â†’ total_points desc. See `_rank_standings`.
    """
    sport_row = supabase.table("sports").select("bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport_row.data:
        return []
    is_pool_swiss = sport_row.data[0].get("bracket_type") == "pool_swiss"

    pool_brackets = (
        supabase.table("brackets")
        .select("id, name")
        .eq("sport_id", sport_id)
        .eq("phase", "pool")
        .order("name")
        .execute()
        .data
    )
    if not pool_brackets:
        return []

    bracket_ids = [b["id"] for b in pool_brackets]
    matches = (
        supabase.table("matches")
        .select(
            "bracket_id, home_team_id, away_team_id, winner_id, status, "
            "home_score, away_score, "
            "home_games_won, away_games_won, home_points_total, away_points_total"
        )
        .in_("bracket_id", bracket_ids)
        .execute()
        .data
    )

    by_bracket: dict[str, list[dict]] = {}
    for m in matches:
        by_bracket.setdefault(m["bracket_id"], []).append(m)

    result = []
    for bracket in pool_brackets:
        bracket_matches = by_bracket.get(bracket["id"], [])
        records = _build_records(bracket_matches, is_pool_swiss=is_pool_swiss)
        standings = _rank_standings(records, matches=bracket_matches, is_pool_swiss=is_pool_swiss)
        result.append({
            "bracket_id": bracket["id"],
            "name": bracket["name"],
            "standings": standings,
        })

    return result


@router.get("/{sport_id}/championship-standings")
def get_championship_standings(sport_id: str):
    """Tournament points standings for the Swiss championship bracket.

    Returns a single standings list computed from all Championship bracket matches.
    Only meaningful for pool_swiss sports (Cornhole).
    Ranking: tournament_points desc â†’ goal_diff desc â†’ goals_for desc.
    """
    championship_bracket = (
        supabase.table("brackets")
        .select("id, name")
        .eq("sport_id", sport_id)
        .eq("phase", "bracket")
        .eq("name", "Championship")
        .limit(1)
        .execute()
        .data
    )
    if not championship_bracket:
        return {"bracket_id": None, "standings": [], "current_round": 0}

    bracket_id = championship_bracket[0]["id"]
    matches = (
        supabase.table("matches")
        .select(
            "id, bracket_id, home_team_id, away_team_id, winner_id, status, match_round, "
            "home_score, away_score, "
            "home_games_won, away_games_won, home_points_total, away_points_total"
        )
        .eq("bracket_id", bracket_id)
        .execute()
        .data
    )

    current_round = max((m["match_round"] or 0 for m in matches), default=0)
    records = _build_records(matches, is_pool_swiss=True)
    standings = _rank_standings(records, is_pool_swiss=True)

    return {
        "bracket_id": bracket_id,
        "standings": standings,
        "current_round": current_round,
    }


@router.post("/{sport_id}/generate-swiss-round")
def generate_swiss_round(sport_id: str, _=Depends(require_admin)):
    """Generate the next Swiss championship round for a pool_swiss sport (Cornhole).

    Round 1: automatically takes the rank-1 team from each pool and generates
    pairings. A "Championship" bracket (phase='bracket') is created.

    Rounds 2â€“N: reads current championship standings, pairs teams by standing
    while avoiding rematches, increments match_round, and inserts new matches.
    Matches are not scheduled (no scheduled_at) â€” admin times them manually.

    Returns 422 if:
    - Sport is not pool_swiss
    - No pool play has been generated yet (Round 1 only)
    - Not all matches in the current round are complete
    """
    from app.bracket_engine.swiss import generate_swiss_pairings

    sport_row = supabase.table("sports").select("bracket_type").eq("id", sport_id).limit(1).execute()
    if not sport_row.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    if sport_row.data[0].get("bracket_type") != "pool_swiss":
        raise HTTPException(status_code=422, detail="Swiss round generation is only supported for pool_swiss sports")

    # Check for an existing Championship bracket
    existing_bracket = (
        supabase.table("brackets")
        .select("id")
        .eq("sport_id", sport_id)
        .eq("phase", "bracket")
        .eq("name", "Championship")
        .limit(1)
        .execute()
        .data
    )

    if not existing_bracket:
        # Round 1 â€” derive teams from pool standings (rank=1 per pool)
        pool_brackets = (
            supabase.table("brackets")
            .select("id, name")
            .eq("sport_id", sport_id)
            .eq("phase", "pool")
            .order("name")
            .execute()
            .data
        )
        if not pool_brackets:
            raise HTTPException(status_code=422, detail="No pool play has been generated for this sport yet")

        bracket_ids = [b["id"] for b in pool_brackets]
        pool_matches = (
            supabase.table("matches")
            .select(
                "bracket_id, home_team_id, away_team_id, winner_id, status, "
                "home_score, away_score, home_games_won, away_games_won, home_points_total, away_points_total"
            )
            .in_("bracket_id", bracket_ids)
            .execute()
            .data
        )

        by_pool: dict[str, list[dict]] = {}
        for m in pool_matches:
            by_pool.setdefault(m["bracket_id"], []).append(m)

        # Take rank-1 team from each pool, ordered by pool name
        seeded_teams: list[str] = []
        for bracket in pool_brackets:
            pool_records = _build_records(by_pool.get(bracket["id"], []), is_pool_swiss=True)
            pool_standings = _rank_standings(pool_records, is_pool_swiss=True)
            winners = [row["team_id"] for row in pool_standings if row["rank"] == 1]
            seeded_teams.extend(winners)

        if len(seeded_teams) < 2:
            raise HTTPException(status_code=422, detail="Need at least 2 pool winners to start the championship")

        championship_bracket = supabase.table("brackets").insert({
            "sport_id": sport_id,
            "name": "Championship",
            "phase": "bracket",
        }).execute().data[0]
        bracket_id = championship_bracket["id"]
        next_round = 1
        previous_matchups: set[frozenset] = set()
        team_order = seeded_teams
    else:
        # Subsequent rounds â€” derive from championship standings
        bracket_id = existing_bracket[0]["id"]
        champ_matches = (
            supabase.table("matches")
            .select(
                "id, home_team_id, away_team_id, winner_id, status, match_round, "
                "home_score, away_score, home_games_won, away_games_won, home_points_total, away_points_total"
            )
            .eq("bracket_id", bracket_id)
            .execute()
            .data
        )

        current_round = max((m["match_round"] or 0 for m in champ_matches), default=0)

        # All matches in the current round must be complete before generating the next
        current_round_matches = [m for m in champ_matches if m["match_round"] == current_round]
        incomplete = [m for m in current_round_matches if m["status"] not in _TERMINAL_STATUSES]
        if incomplete:
            raise HTTPException(
                status_code=422,
                detail=f"Round {current_round} has {len(incomplete)} incomplete match(es). Complete them before generating the next round.",
            )

        # Build previous matchup set to avoid rematches
        previous_matchups: set[frozenset] = set()
        for m in champ_matches:
            if m["home_team_id"] and m["away_team_id"]:
                previous_matchups.add(frozenset([m["home_team_id"], m["away_team_id"]]))

        # Sort teams by current championship standing
        records = _build_records(champ_matches, is_pool_swiss=True)
        standings = _rank_standings(records, is_pool_swiss=True)
        team_order = [row["team_id"] for row in standings]
        next_round = current_round + 1

    pairings = generate_swiss_pairings(team_order, previous_matchups)
    if not pairings:
        raise HTTPException(status_code=422, detail="No valid pairings could be generated")

    rows = [
        {
            "sport_id": sport_id,
            "bracket_id": bracket_id,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "status": "scheduled",
            "match_round": next_round,
        }
        for home_id, away_id in pairings
    ]
    # One bulk insert instead of one round-trip per pairing.
    created = supabase.table("matches").insert(rows).execute().data

    return {
        "bracket_id": bracket_id,
        "round": next_round,
        "matches_created": len(created),
    }


@router.post("/{sport_id}/reconcile-advancement")
def reconcile_advancement(sport_id: str, _=Depends(require_admin)):
    """Re-run bracket advancement for any completed matches whose downstream
    slots never got populated. Optimized to minimize round-trips: fetches all
    matches once, computes needed updates in memory, batches updates.
    Safe to run repeatedly — a slot that already contains the team is skipped.
    """
    all_matches = supabase.table("matches").select(
        "id, status, winner_id, home_team_id, away_team_id, "
        "home_slot_state, away_slot_state, "
        "winner_next_match_id, loser_next_match_id"
    ).eq("sport_id", sport_id).execute().data or []

    by_id = {m["id"]: m for m in all_matches}
    updates_by_match: dict[str, dict] = {}

    def _plan_fill(target_id: str, team_id: str):
        target = by_id.get(target_id)
        if not target:
            return
        # Include any pending in-memory updates so we don't fill twice.
        pending = updates_by_match.get(target_id, {})
        home_team = pending.get("home_team_id", target.get("home_team_id"))
        away_team = pending.get("away_team_id", target.get("away_team_id"))
        if home_team == team_id or away_team == team_id:
            return
        if home_team is None and target.get("home_slot_state") != "bye":
            updates_by_match.setdefault(target_id, {})["home_team_id"] = team_id
        elif away_team is None and target.get("away_slot_state") != "bye":
            updates_by_match.setdefault(target_id, {})["away_team_id"] = team_id

    def _plan_bye(target_id: str):
        target = by_id.get(target_id)
        if not target:
            return
        pending = updates_by_match.get(target_id, {})
        home_state = pending.get("home_slot_state", target.get("home_slot_state"))
        away_state = pending.get("away_slot_state", target.get("away_slot_state"))
        home_team = pending.get("home_team_id", target.get("home_team_id"))
        away_team = pending.get("away_team_id", target.get("away_team_id"))
        if home_team is None and home_state != "bye":
            updates_by_match.setdefault(target_id, {})["home_slot_state"] = "bye"
        elif away_team is None and away_state != "bye":
            updates_by_match.setdefault(target_id, {})["away_slot_state"] = "bye"

    for m in all_matches:
        status = m.get("status")
        w_next = m.get("winner_next_match_id")
        l_next = m.get("loser_next_match_id")
        if status in ("completed", "forfeit") and m.get("winner_id"):
            winner_id = m["winner_id"]
            loser_id = (
                m["away_team_id"] if winner_id == m.get("home_team_id")
                else m.get("home_team_id")
            )
            if w_next:
                _plan_fill(w_next, winner_id)
            if l_next and loser_id:
                _plan_fill(l_next, loser_id)
        elif status == "double_forfeit":
            if w_next:
                _plan_bye(w_next)
            if l_next:
                _plan_bye(l_next)

    # Apply updates: one round-trip per changed match.
    applied = 0
    for match_id, update in updates_by_match.items():
        try:
            supabase.table("matches").update(update).eq("id", match_id).execute()
            applied += 1
        except Exception:
            pass  # keep going; report count at the end

    return {
        "reconciled_count": applied,
        "planned_updates": len(updates_by_match),
        "matches_scanned": len(all_matches),
    }


class RebuildScheduleRequest(BaseModel):
    start_time: str  # ISO datetime, e.g. "2026-07-11T13:00:00-07:00"


@router.post("/{sport_id}/rebuild-remaining-schedule")
def rebuild_remaining_schedule(
    sport_id: str,
    body: RebuildScheduleRequest,
    _=Depends(require_admin),
):
    """Re-slot every `scheduled` (not-yet-started) match for this sport.
    Groups by court, sorts by current scheduled_at, and re-assigns times
    starting at `start_time` at match_duration_minutes intervals per court.
    In-progress and completed matches are left alone.
    """
    try:
        start_dt = datetime.fromisoformat(body.start_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid start_time (expected ISO 8601)")
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)

    sport = supabase.table("sports").select("match_duration_minutes").eq("id", sport_id).limit(1).execute().data
    if not sport:
        raise HTTPException(status_code=404, detail="Sport not found")
    duration = timedelta(minutes=sport[0].get("match_duration_minutes") or 30)

    matches = supabase.table("matches").select(
        "id, status, location_id, scheduled_at"
    ).eq("sport_id", sport_id).eq("status", "scheduled").execute().data or []

    # Group by court (matches without a court get slotted per their own timeline).
    by_court: dict[str, list[dict]] = {}
    unassigned: list[dict] = []
    for m in matches:
        if m.get("location_id"):
            by_court.setdefault(m["location_id"], []).append(m)
        else:
            unassigned.append(m)

    def _sort_key(m: dict) -> str:
        return m.get("scheduled_at") or ""

    updated = 0
    for court_matches in by_court.values():
        court_matches.sort(key=_sort_key)
        cursor = start_dt
        for m in court_matches:
            new_iso = cursor.isoformat()
            try:
                supabase.table("matches").update({"scheduled_at": new_iso}).eq("id", m["id"]).execute()
                updated += 1
            except Exception:
                pass
            cursor = cursor + duration

    # Unassigned matches (e.g. grand final with no court) all get the same
    # start_time; the court ripple/feeder logic in matches.py handles the rest.
    for m in unassigned:
        try:
            supabase.table("matches").update({"scheduled_at": start_dt.isoformat()}).eq("id", m["id"]).execute()
            updated += 1
        except Exception:
            pass

    return {
        "updated": updated,
        "matches_scanned": len(matches),
        "courts": len(by_court),
        "start_time": start_dt.isoformat(),
    }
