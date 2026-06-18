from fastapi import APIRouter, Depends, HTTPException
from app.database import supabase
from app.auth import require_admin
from app.schemas.sport import Sport, SportCreate, SportUpdate
from app.bracket_engine import persist_bracket, persist_pools, clear_brackets
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


class GenerateBracketRequest(BaseModel):
    team_ids: list[str] = []  # ordered by seed — index 0 is the top seed
    clear_existing: bool = False
    # When set (elimination only): one independent bracket per division, each on
    # its own courts, with the division finals feeding a single championship match.
    divisions: list[DivisionSpec] | None = None
    # When set (pool types only): one round-robin pool per entry, each on its own
    # courts. For pool_bracket sports the elimination phase is generated later by
    # calling this endpoint again with team_ids seeded from pool standings.
    pools: list[PoolSpec] | None = None


@router.get("/", response_model=list[Sport])
def list_sports():
    return supabase.table("sports").select("*").order("name").execute().data


@router.get("/{sport_id}", response_model=Sport)
def get_sport(sport_id: str):
    response = supabase.table("sports").select("*").eq("id", sport_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    return response.data[0]


@router.post("/", response_model=Sport, status_code=201)
def create_sport(body: SportCreate, _=Depends(require_admin)):
    return supabase.table("sports").insert(body.model_dump()).execute().data[0]


@router.patch("/{sport_id}", response_model=Sport)
def update_sport(sport_id: str, body: SportUpdate, _=Depends(require_admin)):
    return supabase.table("sports").update(body.model_dump(exclude_none=True, mode="json")).eq("id", sport_id).execute().data[0]


@router.delete("/{sport_id}", status_code=204)
def delete_sport(sport_id: str, _=Depends(require_admin)):
    supabase.table("sports").delete().eq("id", sport_id).execute()


@router.delete("/{sport_id}/brackets", status_code=204)
def reset_brackets(sport_id: str, _=Depends(require_admin)):
    """Delete all brackets and matches for a sport without regenerating."""
    sport = supabase.table("sports").select("id").eq("id", sport_id).limit(1).execute()
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    clear_brackets(sport_id, supabase)


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
        "bracket_type, match_duration_minutes, schedule_start"
    ).eq("id", sport_id).limit(1).execute()

    if not sport_row.data:
        raise HTTPException(status_code=404, detail="Sport not found")

    sport = sport_row.data[0]
    bracket_type = sport.get("bracket_type")

    if body.divisions is not None and bracket_type not in ("single_elimination", "double_elimination"):
        raise HTTPException(status_code=422, detail="Divisions are only supported for elimination brackets")

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

    # Heats: one match per team, no bracket structure
    if bracket_type == "heats":
        if len(body.team_ids) < 1:
            raise HTTPException(status_code=422, detail="At least 1 team is required")

        teams = supabase.table("teams").select("id").eq("sport_id", sport_id).execute()
        valid_ids = {t["id"] for t in teams.data}
        invalid = [tid for tid in body.team_ids if tid not in valid_ids]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Teams not found in this sport: {invalid}")

        if body.clear_existing:
            clear_brackets(sport_id, supabase)

        from datetime import datetime, timezone, timedelta

        duration = sport.get("match_duration_minutes") or 30
        concurrent = len(location_ids) or 1

        start_time = None
        raw_start = sport.get("schedule_start")
        if raw_start:
            if isinstance(raw_start, str):
                start_time = datetime.fromisoformat(raw_start.replace("Z", "+00:00"))
            else:
                start_time = raw_start

        matches = []
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

            m = supabase.table("matches").insert(row).execute().data[0]
            matches.append(m)

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
            sport_id, body, valid_ids, location_ids, start_time, duration
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
        shuffle = False  # team_ids are seeded from pool standings — keep the order
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
    # match advances its winner here. Court is left unassigned (dynamic — the
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
) -> dict:
    """Generate one round-robin pool per PoolSpec, each on its own courts."""
    pools = body.pools or []
    if len(pools) < 1:
        raise HTTPException(status_code=422, detail="At least 1 pool is required")

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

    all_location_ids = [lid for p in pools for lid in p.location_ids]
    if len(set(all_location_ids)) != len(all_location_ids):
        raise HTTPException(status_code=422, detail="A court cannot be assigned to more than one pool")
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
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


_TERMINAL_STATUSES = {"completed", "forfeit", "double_forfeit"}


@router.get("/{sport_id}/standings")
def get_standings(sport_id: str):
    """Win-loss standings per pool, computed from terminal matches.

    completed/forfeit count as a win for winner_id and a loss for the other
    team; double_forfeit counts as a loss for both. Teams are ranked by all
    four tiebreakers in order: match wins → game wins → point differential →
    total points scored. Teams with identical records on all four share a rank.
    """
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
        records: dict[str, dict] = {}

        def record(team_id: str) -> dict:
            return records.setdefault(team_id, {
                "team_id": team_id,
                "wins": 0,
                "losses": 0,
                "played": 0,
                "game_wins": 0,
                "point_diff": 0,
                "total_points": 0,
            })

        for m in by_bracket.get(bracket["id"], []):
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

            if m["status"] == "double_forfeit":
                for tid in (home, away):
                    record(tid)["losses"] += 1
                    record(tid)["played"] += 1
            elif m["winner_id"] in (home, away):
                loser = away if m["winner_id"] == home else home
                record(m["winner_id"])["wins"] += 1
                record(m["winner_id"])["played"] += 1
                record(loser)["losses"] += 1
                record(loser)["played"] += 1

            record(home)["game_wins"] += hgw
            record(home)["point_diff"] += hpt - apt
            record(home)["total_points"] += hpt
            record(away)["game_wins"] += agw
            record(away)["point_diff"] += apt - hpt
            record(away)["total_points"] += apt

        standings = sorted(
            records.values(),
            key=lambda r: (-r["wins"], -r["game_wins"], -r["point_diff"], -r["total_points"]),
        )
        prev_key = None
        for i, row in enumerate(standings):
            key = (row["wins"], row["game_wins"], row["point_diff"], row["total_points"])
            row["rank"] = standings[i - 1]["rank"] if key == prev_key else i + 1
            prev_key = key

        result.append({
            "bracket_id": bracket["id"],
            "name": bracket["name"],
            "standings": standings,
        })

    return result
