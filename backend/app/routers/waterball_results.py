from fastapi import APIRouter, Depends, HTTPException
from app.database import supabase
from app.auth import require_admin
from app.routers.event_points import _compute_points

router = APIRouter()


def _ensure_waterball_mode(sport_id: str) -> dict:
    sport = (
        supabase.table("sports")
        .select("scoring_mode,points_scale")
        .eq("id", sport_id)
        .limit(1)
        .execute()
    )
    if not sport.data:
        raise HTTPException(status_code=404, detail="Sport not found")
    if sport.data[0].get("scoring_mode") != "water_ball_toss":
        raise HTTPException(status_code=422, detail="Sport is not in water_ball_toss scoring mode")
    return sport.data[0]


def _match_points(m: dict) -> int | None:
    """Rounds survived is entered via the generic heat-result endpoint
    (POST /matches/{id}/heat-result) — the same mechanism Human Pyramid/Relay
    Race use for their time, stored as a string in `notes`. Points =
    rounds_survived + 1 (showing up and dropping the first toss is still 1
    point), or 0 on forfeit/double-forfeit; None if the match hasn't been
    played yet. double_forfeit isn't reachable through the water-ball UI
    (which only ever submits single-team forfeit or a result), but the
    generic /matches/{id}/double-forfeit endpoint has no bracket_type guard,
    so it's handled the same as a no-show rather than silently excluded."""
    if m.get("status") in ("forfeit", "double_forfeit"):
        return 0
    if m.get("status") == "completed" and m.get("notes") is not None:
        try:
            return int(m["notes"]) + 1
        except (TypeError, ValueError):
            return None
    return None


def _recompute_event_points(sport_id: str, points_scale: dict | None) -> None:
    """Rebuild event_points for a water-ball-toss sport: each company's score is
    the best of its teams' points (one flat match per team), companies are
    ranked by that score, and the sport's placement scale is awarded (ties
    share the averaged points)."""
    matches = (
        supabase.table("matches")
        .select("home_team_id,notes,status")
        .eq("sport_id", sport_id)
        .execute()
        .data
    )
    supabase.table("event_points").delete().eq("sport_id", sport_id).execute()
    matches = [m for m in matches if m.get("home_team_id")]
    if not matches:
        return

    team_ids = [m["home_team_id"] for m in matches]
    teams = (
        supabase.table("teams")
        .select("id,company_id")
        .in_("id", team_ids)
        .execute()
        .data
    )
    company_by_team = {t["id"]: t["company_id"] for t in teams}

    company_scores: dict[str, int] = {}
    for m in matches:
        points = _match_points(m)
        if points is None:
            continue
        company_id = company_by_team.get(m["home_team_id"])
        if company_id is None:
            continue
        company_scores[company_id] = max(points, company_scores.get(company_id, -1))

    if not company_scores:
        return

    distinct_scores = sorted(set(company_scores.values()), reverse=True)
    payload = []
    placement = 1
    for score in distinct_scores:
        tied_companies = [c for c, s in company_scores.items() if s == score]
        tied_through = placement + len(tied_companies) - 1
        points = _compute_points(placement, points_scale, tied_through)
        for company_id in tied_companies:
            payload.append({
                "company_id": company_id,
                "sport_id": sport_id,
                "placement": placement,
                "points": points,
            })
        placement = tied_through + 1

    if payload:
        supabase.table("event_points").insert(payload).execute()


@router.post("/sports/{sport_id}/recompute", status_code=204)
def recompute_for_sport(sport_id: str, _=Depends(require_admin)):
    sport = _ensure_waterball_mode(sport_id)
    _recompute_event_points(sport_id, sport.get("points_scale"))
