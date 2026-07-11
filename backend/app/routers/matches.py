import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.database import supabase
from app.auth import require_admin
from app.schemas.match import Match, MatchCreate, MatchUpdate, MatchResult, MatchForfeit, MatchDoubleForfeit, MatchDraw, HeatResult
from app.bracket_engine.generator import advance_winner, advance_double_forfeit, settle_bracket, retract_winner, retract_double_forfeit

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


def _push_past_blocks(start, duration, blocks: list[tuple[object, object]]):
    """Shift `start` forward past any schedule block (lunch, group photo, ...)
    that [start, start+duration) would overlap. Loops because blocks can sit
    back-to-back — pushing past one may land inside the next."""
    moved = True
    while moved:
        moved = False
        end = start + duration
        for block_start, block_end in blocks:
            if start < block_end and end > block_start:
                start = block_end
                moved = True
                break
    return start


def _compute_estimated_starts(
    matches: list[dict],
    sport_duration_map: dict[str, int],
    sport_start_map: dict[str, datetime | None] | None = None,
    heats_bracket_ids: set[str] | None = None,
    blocks: list[tuple[datetime, datetime, set[str] | None]] | None = None,
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

    `blocks` are blackout windows (lunch, group photo, ...): a not-yet-started
    match whose slot would overlap one is pushed to start right at the
    block's end instead. A match already in progress is left to finish
    naturally rather than being force-pushed. Each block's third element is
    either None (applies to every sport) or a set of sport_ids it's scoped
    to — e.g. two lunch blocks covering the same window with different
    resume times for different sport groups.
    """
    import heapq
    from datetime import timedelta

    heats_bracket_ids = heats_bracket_ids or set()
    sport_start_map = sport_start_map or {}
    blocks = blocks or []
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

    # Explicitly scheduled, still-pending matches reserve their court: a
    # dynamically-timed match (later round, losers bracket) queues behind the
    # whole plan rather than jumping into a gap. Without this, a round-2 match
    # with a bye feeder becomes "ready" after a single round-1 game and
    # leapfrogs round-1 games the admin scheduled later on the same court.
    court_horizon: dict[str, datetime] = {}
    for m in matches:
        loc = m.get("location_id")
        scheduled = _parse_dt(m.get("scheduled_at"))
        if not loc or scheduled is None:
            continue
        if m.get("status") != "scheduled" or m.get("actual_start"):
            continue  # finished or started matches no longer hold their slot
        planned_finish = scheduled + _duration(m)
        if loc not in court_horizon or planned_finish > court_horizon[loc]:
            court_horizon[loc] = planned_finish

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
                if not _is_bye_autocomplete(m):
                    horizon = court_horizon.get(m.get("location_id") or "")
                    if horizon:
                        constraints.append(horizon)
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
        elif _is_bye_autocomplete(m):
            # Byes need no court: they resolve the moment their feeder ends,
            # without waiting for the court or holding it
            est = _ready(m)
        else:
            est = _ready(m)
            if est is not None:
                if loc and loc in court_free and court_free[loc] > est:
                    est = court_free[loc]
                if blocks:
                    sport_id = m.get("sport_id")
                    relevant_blocks = [
                        (bs, be) for bs, be, sids in blocks if sids is None or sport_id in sids
                    ]
                    if relevant_blocks:
                        est = _push_past_blocks(est, _duration(m), relevant_blocks)
                if loc:
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
            .select("id, match_duration_minutes, schedule_start, bracket_type, scoring_mode")
            .in_("id", sport_ids)
            .execute()
            .data
        )
        sport_duration_map = {s["id"]: s["match_duration_minutes"] or 30 for s in sports}
        sport_start_map = {s["id"]: _parse_dt(s.get("schedule_start")) for s in sports}
        # Executive Golf is bracket_type="heats" (one match per company, no
        # opponent) but companies tee off individually, not simultaneously —
        # unlike every other heats sport (Relay Race, Human Pyramid, Water Ball
        # Toss) where the whole bracket genuinely starts at once. Excluding it
        # here means its matches fall through to the normal per-court ripple
        # below, which staggers them by match_duration_minutes instead of
        # collapsing them all onto one shared start time.
        heats_sport_ids = {
            s["id"] for s in sports
            if s.get("bracket_type") == "heats" and s.get("scoring_mode") != "executive_golf"
        }

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

    block_rows = supabase.table("schedule_blocks").select("start_time, end_time, sport_ids").execute().data
    blocks = [
        (_parse_dt(b["start_time"]), _parse_dt(b["end_time"]), set(b["sport_ids"]) if b.get("sport_ids") else None)
        for b in block_rows
    ]

    estimated = _compute_estimated_starts(matches, sport_duration_map, sport_start_map, heats_bracket_ids, blocks)
    # Baseline with no blocks at all: comparing it to `estimated` tells us
    # whether a match's push is fully explained by a block (baseline was
    # already on/ahead of its scheduled slot) versus real backup that would
    # exist regardless (baseline is itself already late). Skipped when there
    # are no blocks since it would just duplicate `estimated`.
    baseline = (
        _compute_estimated_starts(matches, sport_duration_map, sport_start_map, heats_bracket_ids, None)
        if blocks else estimated
    )
    for m in matches:
        est = estimated.get(m["id"])
        m["estimated_start"] = est
        scheduled = _parse_dt(m.get("scheduled_at"))
        base_est = baseline.get(m["id"])
        m["pushed_by_block"] = bool(
            blocks and est is not None and scheduled is not None and est > scheduled
            and base_est is not None and base_est <= scheduled
        )
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


# Short-lived cache for the UNFILTERED global match list only. The public
# Schedule page fetches every match across every sport and recomputes
# estimated_start on each poll (every ~15s, per open device); under many
# concurrent viewers that is the one read heavy enough to matter. Caching it
# for a few seconds lets every viewer in that window share one computation
# instead of each triggering a full scan + recompute.
#
# Filtered queries (per-sport/bracket/status) are small and are used by admin
# pages that must reflect a just-submitted result immediately, so they are
# deliberately NEVER cached. Staleness here is bounded to the TTL and only
# affects a public read-only view, so no write-side invalidation is needed.
# With multiple workers each holds its own copy — still ~1 recompute per
# worker per window rather than one per request.
_GLOBAL_MATCHES_TTL = 10.0  # seconds
_global_matches_cache: dict[str, tuple[float, list[dict]]] = {}


@router.get("", response_model=list[Match])
def list_matches(
    sport_id: str | None = Query(None),
    bracket_id: str | None = Query(None),
    status: str | None = Query(None),
):
    is_global = sport_id is None and bracket_id is None and status is None
    if is_global:
        cached = _global_matches_cache.get("all")
        if cached and (time.monotonic() - cached[0]) < _GLOBAL_MATCHES_TTL:
            return cached[1]

    q = supabase.table("matches").select("*, locations(name)")
    if sport_id:
        q = q.eq("sport_id", sport_id)
    if bracket_id:
        q = q.eq("bracket_id", bracket_id)
    if status:
        q = q.eq("status", status)
    matches = _fetch_all_matches(q)
    result = _attach_estimated_starts(matches)

    if is_global:
        _global_matches_cache["all"] = (time.monotonic(), result)
    return result


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


class BulkStartRequest(BaseModel):
    match_ids: list[str]


@router.post("/bulk-start", response_model=list[Match])
def bulk_start_matches(body: BulkStartRequest, _=Depends(require_admin)):
    """Start every listed match in one request — e.g. a Water Ball Toss
    group, where all teams' matches start simultaneously for a round rather
    than one at a time. One bulk update instead of N round trips (same
    reasoning as set_pool_setup's bulk upsert). Matches not currently
    'scheduled' are left untouched rather than erroring the whole batch."""
    if not body.match_ids:
        return []
    return supabase.table("matches").update({
        "status": "in_progress",
        "actual_start": _now_iso(),
    }).in_("id", body.match_ids).eq("status", "scheduled").execute().data


def _ensure_result_changeable(match: dict) -> None:
    """409 if either downstream match (winner-advance or loser-drop) has been
    genuinely played. Matches auto-completed by a bye are revertible — the
    retraction cascade unwinds them — so they do not block a correction."""
    for key in ("winner_next_match_id", "loser_next_match_id"):
        next_id = match.get(key)
        if not next_id:
            continue
        downstream = supabase.table("matches").select(
            "status, home_slot_state, away_slot_state"
        ).eq("id", next_id).limit(1).execute()
        if not downstream.data:
            continue
        row = downstream.data[0]
        if row["status"] in ("scheduled", "in_progress"):
            continue
        if row["home_slot_state"] == "bye" or row["away_slot_state"] == "bye":
            continue  # auto-completed by a bye — the retraction cascade reverts it
        raise HTTPException(
            status_code=409,
            detail="Cannot change result: a team from this match has already played further in the bracket.",
        )


def _ensure_double_forfeit_revertible(match: dict) -> None:
    """409 if a downstream match has progressed past the byes this double
    forfeit created. Unlike _ensure_result_changeable, there's no cascade
    unwind for this case (see retract_double_forfeit) — reverting is only
    safe while those matches are still untouched."""
    for key in ("winner_next_match_id", "loser_next_match_id"):
        next_id = match.get(key)
        if not next_id:
            continue
        downstream = supabase.table("matches").select("status").eq("id", next_id).limit(1).execute()
        if downstream.data and downstream.data[0]["status"] != "scheduled":
            raise HTTPException(
                status_code=409,
                detail="Cannot undo: a downstream match has already progressed from this double forfeit.",
            )


@router.post("/{match_id}/result", response_model=Match)
def post_result(match_id: str, result: MatchResult, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id, loser_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    winner_id = str(result.winner_id)

    if winner_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="winner_id must be home_team_id or away_team_id")

    if match["winner_id"]:
        _ensure_result_changeable(match)
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
    if match.get("winner_next_match_id") or match.get("loser_next_match_id"):
        settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/forfeit", response_model=Match)
def post_forfeit(match_id: str, body: MatchForfeit, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "sport_id, home_team_id, away_team_id, winner_id, winner_next_match_id, loser_next_match_id"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    forfeiting_id = str(body.forfeiting_team_id)

    if forfeiting_id not in (match["home_team_id"], match["away_team_id"]):
        raise HTTPException(status_code=422, detail="forfeiting_team_id must be home_team_id or away_team_id")

    winner_id = match["away_team_id"] if forfeiting_id == match["home_team_id"] else match["home_team_id"]

    if match["winner_id"]:
        _ensure_result_changeable(match)
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
    if match.get("winner_next_match_id") or match.get("loser_next_match_id"):
        settle_bracket(match["sport_id"], supabase)

    return updated


@router.post("/{match_id}/double-forfeit", response_model=Match)
def post_double_forfeit(match_id: str, body: MatchDoubleForfeit | None = None, _=Depends(require_admin)):
    response = supabase.table("matches").select(
        "id, sport_id, status, winner_next_match_id, loser_next_match_id"
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
    if match.get("winner_next_match_id") or match.get("loser_next_match_id"):
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


@router.post("/{match_id}/reset", response_model=Match)
def post_reset(match_id: str, _=Depends(require_admin)):
    """Undo a submitted result/forfeit/double-forfeit/draw, returning the match
    to its pre-result state (in_progress if it had been started, else
    scheduled). Reuses the same retraction machinery as correcting a result
    via /result or /forfeit, so it's subject to the same safety rule: blocked
    if a downstream match has genuinely been played further."""
    response = supabase.table("matches").select(
        "sport_id, status, home_team_id, away_team_id, winner_id, "
        "winner_next_match_id, loser_next_match_id, actual_start"
    ).eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")

    match = response.data[0]
    if match["status"] not in ("completed", "forfeit", "double_forfeit", "draw"):
        raise HTTPException(status_code=422, detail="Match has no result to undo")

    if match["winner_id"]:
        _ensure_result_changeable(match)
        loser_id = match["away_team_id"] if match["winner_id"] == match["home_team_id"] else match["home_team_id"]
        retract_winner(match_id, match["winner_id"], loser_id, supabase)
    elif match["status"] == "double_forfeit":
        _ensure_double_forfeit_revertible(match)
        retract_double_forfeit(match_id, supabase)

    update = {
        "winner_id": None,
        "status": "in_progress" if match["actual_start"] else "scheduled",
        "home_score": None,
        "away_score": None,
        "home_games_won": None,
        "away_games_won": None,
        "home_points_total": None,
        "away_points_total": None,
        "played_at": None,
    }
    updated = supabase.table("matches").update(update).eq("id", match_id).execute().data[0]
    if match.get("winner_next_match_id") or match.get("loser_next_match_id"):
        settle_bracket(match["sport_id"], supabase)
    return updated


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
    # exclude_unset (not exclude_none): a caller explicitly sending home_score/
    # away_score: null means "clear the score" — exclude_none would silently
    # drop that key and leave the old score in place.
    updates = body.model_dump(exclude_unset=True, mode="json")
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    response = supabase.table("matches").select("id").eq("id", match_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Match not found")
    return supabase.table("matches").update(updates).eq("id", match_id).execute().data[0]


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: str, _=Depends(require_admin)):
    supabase.table("matches").delete().eq("id", match_id).execute()
