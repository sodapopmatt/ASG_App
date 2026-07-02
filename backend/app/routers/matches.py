from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import supabase
from app.auth import require_admin
from app.schemas.match import Match, MatchCreate, MatchUpdate, MatchResult, MatchForfeit, MatchDoubleForfeit, MatchDraw, HeatResult
from app.bracket_engine.generator import advance_winner, advance_double_forfeit, settle_bracket, retract_winner

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _is_bye_autocomplete(m: dict) -> bool:
    """True when one slot is a permanent bye — the match resolves instantly, zero play time."""
    return m.get("home_slot_state") == "bye" or m.get("away_slot_state") == "bye"


def _compute_estimated_starts(
    matches: list[dict],
    sport_duration_map: dict[str, int],
    sport_start_map: dict[str, datetime | None] | None = None,
    heats_bracket_ids: set[str] | None = None,
) -> dict[str, datetime | None]:
    """Compute estimated start times accounting for court availability and feeder matches.

    Single unified sweep. Matches are finalized in dependency (topological)
    order via a priority queue, earliest-ready first. A match's ready time is
    the max of:
      - its scheduled_at (if set),
      - its sport's schedule_start (when playable but never scheduled),
      - the finish times of its feeder matches (winner_next / loser_next links).
    Its estimate is then pushed forward to when its court is next free. Court
    free times only ever advance, so two matches can never overlap on a court.

    Bye-autocomplete matches (one slot a permanent bye) occupy zero court time
    and add no delay downstream — they resolve the moment their feeder ends.

    Heats brackets (concurrent teams): all matches in the same bracket share one
    estimated_start and occupy the court for exactly one duration slot.

    actual_start anchors a court's timeline when a match is in progress.
    Terminal matches (completed / forfeit / double_forfeit / draw) keep their
    scheduled slot if they had one, otherwise carry no estimate.
    """
    import heapq
    from datetime import timedelta

    heats_bracket_ids = heats_bracket_ids or set()
    sport_start_map = sport_start_map or {}
    _TERMINAL = ("completed", "forfeit", "double_forfeit", "draw")

    match_by_id = {m["id"]: m for m in matches}
    seq = {m["id"]: i for i, m in enumerate(matches)}

    def _duration(m: dict) -> timedelta:
        if _is_bye_autocomplete(m):
            return timedelta(0)
        return timedelta(minutes=sport_duration_map.get(m.get("sport_id", ""), 30))

    # Dependency graph: a match enters the queue only once every feeder that
    # exists in this match set has been finalized, so feeder finish times are
    # always complete when a match's ready time is computed.
    downstream_of: dict[str, list[str]] = {}
    in_degree = {m["id"]: 0 for m in matches}
    for m in matches:
        for key in ("winner_next_match_id", "loser_next_match_id"):
            next_id = m.get(key)
            if next_id and next_id in match_by_id:
                downstream_of.setdefault(m["id"], []).append(next_id)
                in_degree[next_id] += 1

    feeder_finish: dict[str, datetime] = {}  # match_id -> latest feeder finish

    def _ready(m: dict) -> datetime | None:
        actual = _parse_dt(m.get("actual_start"))
        if actual:
            return actual
        constraints = []
        scheduled = _parse_dt(m.get("scheduled_at"))
        if scheduled:
            constraints.append(scheduled)
        if m.get("status") not in _TERMINAL:
            if scheduled is None:
                sport_start = sport_start_map.get(m.get("sport_id", ""))
                if sport_start and (m.get("home_team_id") or m.get("away_team_id")):
                    constraints.append(sport_start)
            finish = feeder_finish.get(m["id"])
            if finish:
                constraints.append(finish)
        return max(constraints) if constraints else None

    def _key(mid: str) -> tuple:
        m = match_by_id[mid]
        ready = _ready(m)
        ts = ready.timestamp() if ready else float("-inf")
        return (ts, m.get("match_round") or 0, seq[mid])

    heap = [(_key(m["id"]), m["id"]) for m in matches if in_degree[m["id"]] == 0]
    heapq.heapify(heap)

    result: dict[str, datetime | None] = {}
    court_free: dict[str, datetime] = {}
    heat_est: dict[str, datetime | None] = {}  # bracket_id -> shared start

    while heap:
        _, mid = heapq.heappop(heap)
        m = match_by_id[mid]
        loc = m.get("location_id")
        bracket_id = m.get("bracket_id")
        is_concurrent = bracket_id in heats_bracket_ids
        actual = _parse_dt(m.get("actual_start"))

        if is_concurrent and bracket_id in heat_est:
            # Concurrent heat: reuse the bracket's start, no extra court time
            est = heat_est[bracket_id]
        elif actual:
            est = actual
            if loc:
                court_free[loc] = actual + _duration(m)  # anchor the timeline
        else:
            est = _ready(m)
            if est is not None and loc:
                if loc in court_free and court_free[loc] > est:
                    est = court_free[loc]
                court_free[loc] = est + _duration(m)

        if is_concurrent and bracket_id not in heat_est:
            heat_est[bracket_id] = est

        # Bye-autocomplete matches are never actually played — expose no
        # estimated_start (a time would render as a phantom game in the UI),
        # but keep propagating their finish so downstream timing stays right.
        result[mid] = None if _is_bye_autocomplete(m) else est

        finish = est + _duration(m) if est is not None else None
        for next_id in downstream_of.get(mid, []):
            if finish is not None:
                prev = feeder_finish.get(next_id)
                if prev is None or finish > prev:
                    feeder_finish[next_id] = finish
            in_degree[next_id] -= 1
            if in_degree[next_id] == 0:
                heapq.heappush(heap, (_key(next_id), next_id))

    return result


def _attach_estimated_starts(matches: list[dict]) -> list[dict]:
    """Fetch sport durations and schedule_start, compute estimated_start, and attach to each match dict."""
    sport_ids = list({m["sport_id"] for m in matches if m.get("sport_id")})
    sport_duration_map: dict[str, int] = {}
    sport_start_map: dict[str, datetime | None] = {}
    heats_sport_ids: set[str] = set()
    if sport_ids:
        sports = (
            supabase.table("sports")
            .select("id, match_duration_minutes, schedule_start, bracket_type")
            .in_("id", sport_ids)
            .execute()
            .data
        )
        sport_duration_map = {s["id"]: s["match_duration_minutes"] or 30 for s in sports}
        sport_start_map = {s["id"]: _parse_dt(s.get("schedule_start")) for s in sports}
        heats_sport_ids = {s["id"] for s in sports if s.get("bracket_type") == "heats"}

    # Heats brackets have concurrent teams â€” their matches share one time slot.
    # Only applies to sports with bracket_type="heats"; other bracket types (e.g.
    # single_elimination) also use phase="bracket" but are NOT concurrent.
    heats_bracket_ids: set[str] = set()
    bracket_ids = list({m["bracket_id"] for m in matches if m.get("bracket_id")})
    if bracket_ids:
        brackets = (
            supabase.table("brackets")
            .select("id, phase, sport_id")
            .in_("id", bracket_ids)
            .execute()
            .data
        )
        heats_bracket_ids = {
            b["id"] for b in brackets
            if b.get("phase") in ("heats", "bracket", "finals")
            and b.get("sport_id") in heats_sport_ids
        }

    estimated = _compute_estimated_starts(matches, sport_duration_map, sport_start_map, heats_bracket_ids)
    for m in matches:
        m["estimated_start"] = estimated.get(m["id"])
    return matches


def _assign_dynamic_court(match_id: str) -> None:
    """If the winner's next match has no court yet, assign it this match's court.

    Called after a result is posted. The first of the two semifinal finishers
    claims the court for the grand final; the second finds it already set.
    """
    current = (
        supabase.table("matches")
        .select("location_id, winner_next_match_id")
        .eq("id", match_id)
        .limit(1)
        .execute()
    )
    if not current.data:
        return
    row = current.data[0]
    court = row.get("location_id")
    next_id = row.get("winner_next_match_id")
    if not next_id or not court:
        return

    next_match = (
        supabase.table("matches")
        .select("location_id")
        .eq("id", next_id)
        .limit(1)
        .execute()
    )
    if next_match.data and next_match.data[0].get("location_id") is None:
        supabase.table("matches").update({"location_id": court}).eq("id", next_id).execute()


def _fetch_all_matches(q) -> list[dict]:
    """Paginate through all matches, bypassing PostgREST's 1000-row default cap."""
    results = []
    page_size = 1000
    page = 0
    while True:
        batch = q.order("match_round").order("scheduled_at").range(
            page * page_size, (page + 1) * page_size - 1
        ).execute().data
        results.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return results


@router.get("", response_model=list[Match])
def list_matches(
    sport_id: str | None = Query(None),
    bracket_id: str | None = Query(None),
    status: str | None = Query(None),
):
    q = supabase.table("matches").select("*, locations(name)")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    if bracket_id:
        q = q.eq("bracket_id", bracket_id)
    if status:
        q = q.eq("status", status)
    matches = _fetch_all_matches(q)
    return _attach_estimated_starts(matches)


@router.get("/{match_id}", response_model=Match)
def get_match(match_id: str):
    response = supabase.table("matches").select("*, locations(name)").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    m = response.data[0]

    # Fetch all matches for the sport so feeder timing is available for Pass 2
    if m.get("sport_id"):
        sport_matches = _fetch_all_matches(
            supabase.table("matches")
            .select("*, locations(name)")
            .eq("sport_id", m["sport_id"])
        )
        _attach_estimated_starts(sport_matches)
        match_map = {sm["id"]: sm for sm in sport_matches}
        if match_id in match_map:
            m["estimated_start"] = match_map[match_id].get("estimated_start")

    return m


@router.post("", response_model=Match, status_code=201)
def create_match(body: MatchCreate, _=Depends(require_admin)):
    return supabase.table("matches").insert(body.model_dump(mode="json")).execute().data[0]


@router.post("/{match_id}/start", response_model=Match)
def start_match(match_id: str, _=Depends(require_admin)):
    response = supabase.table("matches").select("id, status").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    if response.data[0]["status"] != "scheduled":
        raise HTTPException(status_code=422, detail="Only scheduled matches can be started")
    return supabase.table("matches").update({
        "status": "in_progress",
        "actual_start": _now_iso(),
    }).eq("id", match_id).execute().data[0]


@router.post("/{match_id}/result", response_model=Match)
def post_result(match_id: str, result: MatchResult, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    winner_id = str(result.winner_id)

    if winner_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="winner_id must be home_team_id or away_team_id")

    if match["winner_id"]:
        if match.get("winner_next_match_id"):
            downstream = supabase.table("matches").select("status").eq(
                "id", match["winner_next_match_id"]
            ).limit(1).execute()
            if downstream.data and downstream.data[0]["status"] not in ("scheduled", "in_progress"):
                raise HTTPException(
                    status_code=409,
                    detail="Cannot change result: the advanced team has already played further in the bracket.",
                )
        prev_winner = match["winner_id"]
        prev_loser = match["away_team_id"] if prev_winner == match["home_team_id"] else match["home_team_id"]
        retract_winner(match_id, prev_winner, prev_loser, supabase)

    update: dict = {
        "winner_id": winner_id,
        "status": "completed",
        "home_score": result.home_score,
        "away_score": result.away_score,
        "home_games_won": result.home_games_won,
        "away_games_won": result.away_games_won,
        "home_points_total": result.home_points_total,
        "away_points_total": result.away_points_total,
        "played_at": result.played_at.isoformat() if result.played_at else _now_iso(),
    }
    if result.notes:
        update["notes"] = result.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]

    loser_id = match["away_team_id"] if winner_id == match["home_team_id"] else match["home_team_id"]
    advance_winner(match_id, winner_id, loser_id, supabase)
    _assign_dynamic_court(match_id)
    settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/forfeit", response_model=Match)
def post_forfeit(match_id: str, body: MatchForfeit, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    forfeiting_id = str(body.forfeiting_team_id)

    if forfeiting_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="forfeiting_team_id must be home_team_id or away_team_id")

    winner_id = match["away_team_id"] if forfeiting_id == match["home_team_id"] else match["home_team_id"]

    if match["winner_id"]:
        if match.get("winner_next_match_id"):
            downstream = supabase.table("matches").select("status").eq(
                "id", match["winner_next_match_id"]
            ).limit(1).execute()
            if downstream.data and downstream.data[0]["status"] not in ("scheduled", "in_progress"):
                raise HTTPException(
                    status_code=409,
                    detail="Cannot change result: the advanced team has already played further in the bracket.",
                )
        prev_winner = match["winner_id"]
        prev_loser = match["away_team_id"] if prev_winner == match["home_team_id"] else match["home_team_id"]
        retract_winner(match_id, prev_winner, prev_loser, supabase)

    update: dict = {
        "winner_id": winner_id,
        "status": "forfeit",
        "home_score": None,
        "away_score": None,
        "played_at": _now_iso(),
    }
    if body.notes:
        update["notes"] = body.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]

    advance_winner(match_id, winner_id, forfeiting_id, supabase)
    _assign_dynamic_court(match_id)
    settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/double-forfeit", response_model=Match)
def post_double_forfeit(match_id: str, body: MatchDoubleForfeit | None = None, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "id, sport_id, status"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    if match["status"] not in ("scheduled", "in_progress"):
        raise HTTPException(status_code=422, detail="Match is already resolved")

    update: dict = {
        "status": "double_forfeit",
        "winner_id": None,
        "home_score": None,
        "away_score": None,
        "played_at": _now_iso(),
    }
    if body and body.notes:
        update["notes"] = body.notes

    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]
    advance_double_forfeit(match_id, supabase)
    settle_bracket(match["sport_id"], supabase)
    return updated


@router.post("/{match_id}/draw", response_model=Match)
def post_draw(match_id: str, body: MatchDraw | None = None, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "id, sport_id, status, winner_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    if match["status"] not in ("scheduled", "in_progress"):
        raise HTTPException(status_code=422, detail="Match is already resolved")
    if match.get("winner_next_match_id"):
        raise HTTPException(status_code=422, detail="Draw is only valid for pool play matches with no bracket advancement")

    update: dict = {
        "status": "draw",
        "winner_id": None,
        "home_score": body.home_score if body else None,
        "away_score": body.away_score if body else None,
        "played_at": body.played_at.isoformat() if body and body.played_at else _now_iso(),
    }
    if body and body.notes:
        update["notes"] = body.notes

    return supabase.table("matches").update(update).eq("id", match_id).execute().data[0]


@router.post("/{match_id}/heat-result", response_model=Match)
def post_heat_result(match_id: str, body: HeatResult, _=Depends(require_admin)):
    """Record a heat time or forfeit for a heats-type sport match."""
    if body.forfeit and body.time_ms is not None:
        raise HTTPException(status_code=422, detail="Provide either time_ms or forfeit, not both")
    if not body.forfeit and body.time_ms is None:
        raise HTTPException(status_code=422, detail="Provide time_ms or set forfeit=true")
    if body.time_ms is not None and body.time_ms < 0:
        raise HTTPException(status_code=422, detail="time_ms must be non-negative")

    row = supabase.table("matches").select("id, sport_id").eq("id", match_id).limit(1).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Match not found")

    sport = supabase.table("sports").select("bracket_type").eq("id", row.data[0]["sport_id"]).limit(1).execute()
    if not sport.data or sport.data[0]["bracket_type"] != "heats":
        raise HTTPException(status_code=422, detail="This endpoint is only valid for heats-type sports")

    if body.forfeit:
        update: dict = {"status": "forfeit", "winner_id": None, "notes": None, "played_at": _now_iso()}
    else:
        update = {"status": "completed", "notes": str(body.time_ms), "winner_id": None, "played_at": _now_iso()}

    return supabase.table("matches").update(update).eq("id", match_id).execute().data[0]


@router.patch("/{match_id}", response_model=Match)
def update_match(match_id: str, body: MatchUpdate, _=Depends(require_admin)):
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    response = supabase.table("matches").select("id").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    return supabase.table("matches").update(updates).eq("id", match_id).execute().data[0]


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: str, _=Depends(require_admin)):
    supabase.table("matches").delete().eq("id", match_id).execute()
